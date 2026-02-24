"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { LiveSegment, TranslatedSegment } from "@/types";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { createPushStreamFromMediaStream } from "@/lib/audioStreamAdapter";

interface UseTranslationRecognizerOptions {
  subscriptionKey: string;
  region: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** フレーズリスト（Issue #34: 固有名詞・専門用語の認識精度向上） */
  phraseList?: string[];
  /** Issue #167: 共有 MediaStream（指定時はこのストリームを使用） */
  sharedStream?: MediaStream | null;
}

interface UseTranslationRecognizerReturn {
  isListening: boolean;
  isPaused: boolean;
  transcript: string;
  segments: LiveSegment[];
  translatedSegments: TranslatedSegment[];
  interimTranscript: string;
  interimTranslation: string;
  translatedFullText: string;
  error: string | null;
  startListening: (streamOverride?: MediaStream | null) => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
  /** Issue #126: セグメントを部分更新（リアルタイム補正用） */
  updateSegment: (segmentId: string, patch: Partial<LiveSegment>) => void;
}

/**
 * Issue #35: TranslationRecognizer フック
 *
 * Azure Speech SDK の TranslationRecognizer を使い、音声認識と翻訳を
 * 1パイプラインで同時出力する。Translator REST API への追加呼び出しが
 * 不要なため、翻訳レイテンシをほぼゼロにできる。
 *
 * 制約: ConversationTranscriber（話者識別）との併用不可。
 *       話者識別 ON 時は useSpeechRecognition + useTranslation にフォールバック。
 */
export function useTranslationRecognizer(
  options: UseTranslationRecognizerOptions
): UseTranslationRecognizerReturn {
  const {
    subscriptionKey,
    region,
    sourceLanguage,
    targetLanguage,
    phraseList = [],
    sharedStream = null,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [translatedSegments, setTranslatedSegments] = useState<TranslatedSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [interimTranslation, setInterimTranslation] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Derived values
  const transcript = useMemo(
    () => segments.map((s) => s.text).join(" "),
    [segments]
  );
  const translatedFullText = useMemo(
    () => translatedSegments.map((s) => s.translatedText).join(" "),
    [translatedSegments]
  );

  const recognizerRef = useRef<SpeechSDK.TranslationRecognizer | null>(null);
  const isPausingRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const segmentIdRef = useRef(0);
  // Issue #167: PushStream のクリーンアップ関数を保持
  const pushStreamCleanupRef = useRef<(() => void) | null>(null);

  /**
   * SUPPORTED_LANGUAGES から translatorCode を取得する。
   * BUG-2 修正: split("-")[0] では "zh-CN" → "zh" となり中国語翻訳が失敗する。
   * translatorCode を使えば "zh-CN" → "zh-Hans" と正しく変換される。
   */
  const getTranslatorCode = useCallback((langCode: string): string => {
    const langConfig = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
    return langConfig?.translatorCode || langCode.split("-")[0];
  }, []);

  const startListening = useCallback((streamOverride?: MediaStream | null) => {
    if (!subscriptionKey || !region) {
      setError("Speech Services の設定がありません");
      return;
    }

    try {
      setError(null);
      setSegments([]);
      setTranslatedSegments([]);
      segmentIdRef.current = 0;
      setInterimTranscript("");
      setInterimTranslation("");
      startTimeRef.current = Date.now();

      // Issue #172: streamOverride > sharedStream > defaultMic の優先順位
      const activeStream = streamOverride ?? sharedStream;

      const translationConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(
        subscriptionKey,
        region
      );
      translationConfig.speechRecognitionLanguage = sourceLanguage;

      // 翻訳先言語を追加（translatorCode 形式: "en", "zh-Hans" 等）
      const targetLangCode = getTranslatorCode(targetLanguage);
      translationConfig.addTargetLanguage(targetLangCode);

      // Issue #172: activeStream が渡された場合は fromStreamInput を使用
      let audioConfig: SpeechSDK.AudioConfig;
      if (activeStream) {
        const { pushStream, cleanup } = createPushStreamFromMediaStream(activeStream);
        audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
        pushStreamCleanupRef.current = cleanup;
      } else {
        audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      }
      const recognizer = new SpeechSDK.TranslationRecognizer(
        translationConfig,
        audioConfig
      );

      // Issue #34: フレーズリスト適用
      if (phraseList.length > 0) {
        const grammar = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
        for (const phrase of phraseList) {
          grammar.addPhrase(phrase);
        }
      }

      // 中間結果: 原文 + 翻訳が同時に出力される
      recognizer.recognizing = (_sender, event) => {
        if (event.result.reason === SpeechSDK.ResultReason.TranslatingSpeech) {
          setInterimTranscript(event.result.text);
          setInterimTranslation(
            event.result.translations.get(targetLangCode) || ""
          );
        }
      };

      // 確定結果: セグメントと翻訳セグメントを同時生成
      recognizer.recognized = (_sender, event) => {
        if (event.result.reason === SpeechSDK.ResultReason.TranslatedSpeech) {
          const segId = `seg-${++segmentIdRef.current}`;
          const newText = event.result.text;
          const newTranslation =
            event.result.translations.get(targetLangCode) || "";

          if (newText.trim()) {
            setSegments((prev) => [
              ...prev,
              {
                id: segId,
                text: newText,
                timestamp: Date.now() - startTimeRef.current,
              },
            ]);

            setTranslatedSegments((prev) => [
              ...prev,
              {
                segmentId: segId,
                originalText: newText,
                translatedText: newTranslation,
              },
            ]);
          }

          setInterimTranscript("");
          setInterimTranslation("");
        }
      };

      // エラーハンドリング
      recognizer.canceled = (_sender, event) => {
        if (event.reason === SpeechSDK.CancellationReason.Error) {
          setError(`翻訳認識エラー: ${event.errorDetails}`);
        }
        if (!isPausingRef.current) {
          setIsListening(false);
        }
      };

      // セッション終了
      recognizer.sessionStopped = () => {
        if (!isPausingRef.current) {
          setIsListening(false);
        }
      };

      recognizerRef.current = recognizer;
      recognizer.startContinuousRecognitionAsync(
        () => setIsListening(true),
        (err) => {
          setError(`開始エラー: ${err}`);
          setIsListening(false);
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`初期化エラー: ${message}`);
    }
  }, [subscriptionKey, region, sourceLanguage, targetLanguage, getTranslatorCode, phraseList, sharedStream]);

  const stopListening = useCallback(() => {
    isPausingRef.current = false;

    // Issue #167: PushStream のクリーンアップ
    if (pushStreamCleanupRef.current) {
      pushStreamCleanupRef.current();
      pushStreamCleanupRef.current = null;
    }

    if (recognizerRef.current) {
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsListening(false);
          setIsPaused(false);
          recognizerRef.current?.close();
          recognizerRef.current = null;
        },
        (err) => {
          setError(`停止エラー: ${err}`);
        }
      );
    }
  }, []);

  const pauseListening = useCallback(() => {
    if (recognizerRef.current && isListening && !isPaused) {
      isPausingRef.current = true;
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsPaused(true);
          setInterimTranscript("");
          setInterimTranslation("");
        },
        (err) => {
          isPausingRef.current = false;
          setError(`一時停止エラー: ${err}`);
        }
      );
    }
  }, [isListening, isPaused]);

  const resumeListening = useCallback(() => {
    if (isPaused) {
      isPausingRef.current = false;

      // TranslationRecognizer: 同一インスタンスで再開を試みる
      if (recognizerRef.current) {
        recognizerRef.current.startContinuousRecognitionAsync(
          () => {
            setIsListening(true);
            setIsPaused(false);
          },
          (err) => {
            // 同一インスタンスでの再開失敗 → 新インスタンスで再作成
            setError(`再開エラー: ${err}`);
            recognizerRef.current?.close();
            recognizerRef.current = null;
            setIsPaused(false);
            setIsListening(false);
          }
        );
      }
    }
  }, [isPaused]);

  const resetTranscript = useCallback(() => {
    setSegments([]);
    setTranslatedSegments([]);
    segmentIdRef.current = 0;
    setInterimTranscript("");
    setInterimTranslation("");
  }, []);

  // Issue #126: セグメント部分更新（リアルタイムAI補正用）
  const updateSegment = useCallback((segmentId: string, patch: Partial<LiveSegment>) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === segmentId ? { ...seg, ...patch } : seg))
    );
  }, []);

  return {
    isListening,
    isPaused,
    transcript,
    segments,
    translatedSegments,
    interimTranscript,
    interimTranslation,
    translatedFullText,
    error,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    resetTranscript,
    updateSegment,
  };
}
