"use client";

import { useCallback, useRef, useState } from "react";

/** Issue #167: 音声ソースモード */
export type AudioSourceMode = "mic" | "system" | "both";

interface UseAudioSourceReturn {
  /** 統合された MediaStream（録音・音声認識に使用） */
  stream: MediaStream | null;
  /** ストリーム取得中フラグ */
  isAcquiring: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** ストリーム取得（録音開始時に呼ぶ） */
  acquireStream: () => Promise<MediaStream>;
  /** ストリーム解放（録音停止時に呼ぶ） */
  releaseStream: () => void;
  /** getDisplayMedia API が利用可能かどうか */
  isSystemAudioSupported: boolean;
}

/**
 * Issue #167: 音声ソース管理フック
 *
 * 3つの音声ソースモードを統一的に管理し、単一の MediaStream を返却する。
 *
 * - 'mic':    getUserMedia({ audio }) — マイクのみ（既存動作）
 * - 'system': getDisplayMedia({ audio, systemAudio }) — システム音声のみ
 * - 'both':   AudioContext で mic + system をミックス
 *
 * @param mode - 音声ソースモード
 */
export function useAudioSource(mode: AudioSourceMode): UseAudioSourceReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // リソース管理用 Ref
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // getDisplayMedia の利用可否判定
  const isSystemAudioSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    "getDisplayMedia" in navigator.mediaDevices;

  /** マイクストリームを取得 */
  const getMicStream = useCallback(async (): Promise<MediaStream> => {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    });
  }, []);

  /** システム音声ストリームを取得 */
  const getSystemStream = useCallback(async (): Promise<MediaStream> => {
    const displayStream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: false,
      audio: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      systemAudio: "include",
    } as any);

    // video トラックは不要なので削除
    displayStream.getVideoTracks().forEach((track) => track.stop());

    // audio トラックがない場合（ユーザーが「システム音声を共有」をチェックしなかった）
    if (displayStream.getAudioTracks().length === 0) {
      throw new Error(
        "システム音声が取得できませんでした。共有ダイアログで「システム音声を共有」にチェックしてください。"
      );
    }

    return displayStream;
  }, []);

  /** 2つの MediaStream を AudioContext でミックスする */
  const mixStreams = useCallback(
    async (mic: MediaStream, system: MediaStream): Promise<MediaStream> => {
      const ctx = new AudioContext();
      // Chrome はユーザージェスチャーなしで AudioContext を作ると suspended のまま
      await ctx.resume();

      const destination = ctx.createMediaStreamDestination();
      const micSource = ctx.createMediaStreamSource(mic);
      const systemSource = ctx.createMediaStreamSource(system);

      micSource.connect(destination);
      systemSource.connect(destination);

      audioContextRef.current = ctx;

      return destination.stream;
    },
    []
  );

  /** ストリーム解放（内部用） */
  const releaseStreamInternal = useCallback(() => {
    // AudioContext クリーンアップ
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // マイクストリーム停止
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    // システム音声ストリーム停止
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }

    setStream(null);
  }, []);

  /** ストリーム取得（録音開始時に呼ぶ） */
  const acquireStream = useCallback(async (): Promise<MediaStream> => {
    setIsAcquiring(true);
    setError(null);

    try {
      let resultStream: MediaStream;

      switch (mode) {
        case "mic": {
          const mic = await getMicStream();
          micStreamRef.current = mic;
          resultStream = mic;
          break;
        }

        case "system": {
          if (!isSystemAudioSupported) {
            throw new Error(
              "このブラウザはシステム音声キャプチャに対応していません。Chrome または Edge をお使いください。"
            );
          }
          const system = await getSystemStream();
          systemStreamRef.current = system;
          resultStream = system;
          break;
        }

        case "both": {
          if (!isSystemAudioSupported) {
            throw new Error(
              "このブラウザはシステム音声キャプチャに対応していません。Chrome または Edge をお使いください。"
            );
          }
          // マイクとシステム音声を並行取得
          const [mic, system] = await Promise.all([
            getMicStream(),
            getSystemStream(),
          ]);
          micStreamRef.current = mic;
          systemStreamRef.current = system;

          // AudioContext でミックス
          resultStream = await mixStreams(mic, system);
          break;
        }
      }

      // track.onended ハンドリング（ユーザーが「共有を停止」した場合）
      resultStream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setError("音声共有が停止されました");
          releaseStreamInternal();
        };
      });

      setStream(resultStream);
      return resultStream;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "音声の取得に失敗しました";
      setError(message);
      // 途中まで取得したストリームを解放
      releaseStreamInternal();
      throw err;
    } finally {
      setIsAcquiring(false);
    }
  }, [mode, getMicStream, getSystemStream, mixStreams, isSystemAudioSupported, releaseStreamInternal]);

  /** ストリーム解放（録音停止時に呼ぶ） */
  const releaseStream = useCallback(() => {
    releaseStreamInternal();
    setError(null);
  }, [releaseStreamInternal]);

  return {
    stream,
    isAcquiring,
    error,
    acquireStream,
    releaseStream,
    isSystemAudioSupported,
  };
}
