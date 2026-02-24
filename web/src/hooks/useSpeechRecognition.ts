"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { LiveSegment } from "@/types";
import { createPushStreamFromMediaStream } from "@/lib/audioStreamAdapter";

interface UseSpeechRecognitionOptions {
  subscriptionKey: string;
  region: string;
  language?: string;
  enableSpeakerDiarization?: boolean;
  /** 共有 MediaStream（指定時はこのストリームを使用し、独自に getUserMedia を呼ばない） */
  sharedStream?: MediaStream | null;
  /** フレーズリスト（固有名詞・専門用語を登録して音声認別精度を向上） */
  phraseList?: string[];
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isPaused: boolean;
  transcript: string;
  segments: LiveSegment[];
  interimTranscript: string;
  error: string | null;
  startListening: (streamOverride?: MediaStream | null) => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
  /** Issue #126: セグメントを部分更新（リアルタイム補正用） */
  updateSegment: (segmentId: string, patch: Partial<LiveSegment>) => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions
): UseSpeechRecognitionReturn {
  const { subscriptionKey, region, language = "ja-JP", enableSpeakerDiarization = false, sharedStream = null, phraseList = [] } = options;

  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Derived transcript from segments (primary data = segments)
  const transcript = useMemo(
    () => segments.map((s) => s.text).join(" "),
    [segments]
  );

  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const transcriberRef = useRef<SpeechSDK.ConversationTranscriber | null>(null);
  const pausedTranscriptRef = useRef<string>("");
  const isPausingRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const segmentIdRef = useRef(0);
  // Issue #167: PushStream のクリーンアップ関数を保持
  const pushStreamCleanupRef = useRef<(() => void) | null>(null);

  /** ConversationTranscriber を作成して開始する内部ヘルパー */
  const startConversationTranscriber = useCallback(
    (speechConfig: SpeechSDK.SpeechConfig, activeStream?: MediaStream | null) => {
      // Issue #172: activeStream > sharedStream > defaultMic の優先順位
      const streamToUse = activeStream ?? sharedStream;
      let audioConfig: SpeechSDK.AudioConfig;
      if (streamToUse) {
        const { pushStream, cleanup } = createPushStreamFromMediaStream(streamToUse);
        audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
        pushStreamCleanupRef.current = cleanup;
      } else {
        audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      }
      const transcriber = new SpeechSDK.ConversationTranscriber(speechConfig, audioConfig);

      // フレーズリスト適用（PhraseListGrammar で固有名詞・専門用語の認識精度向上）
      if (phraseList.length > 0) {
        try {
          const phraseListGrammar = SpeechSDK.PhraseListGrammar.fromRecognizer(transcriber as unknown as SpeechSDK.Recognizer);
          for (const phrase of phraseList) {
            phraseListGrammar.addPhrase(phrase);
          }
        } catch {
          // ConversationTranscriber で PhraseListGrammar がサポートされない場合は無視
        }
      }

      // 中間結果
      transcriber.transcribing = (_sender: unknown, event: SpeechSDK.ConversationTranscriptionEventArgs) => {
        if (event.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
          setInterimTranscript(event.result.text);
        }
      };

      // 確定結果
      transcriber.transcribed = (_sender: unknown, event: SpeechSDK.ConversationTranscriptionEventArgs) => {
        if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          const newText = event.result.text;
          const speakerId = event.result.speakerId || "Unknown";

          setSegments((prev) => [
            ...prev,
            {
              id: `seg-${++segmentIdRef.current}`,
              text: newText,
              speaker: speakerId,
              timestamp: event.result.offset
                ? event.result.offset / 10000
                : Date.now() - startTimeRef.current,
              duration: event.result.duration
                ? event.result.duration / 10000
                : undefined,
            },
          ]);
          setInterimTranscript("");
        }
      };

      // エラー
      transcriber.canceled = (_sender: unknown, event: SpeechSDK.ConversationTranscriptionCanceledEventArgs) => {
        if (event.reason === SpeechSDK.CancellationReason.Error) {
          setError(`話者識別エラー: ${event.errorDetails}`);
        }
        setIsListening(false);
      };

      // セッション終了
      transcriber.sessionStopped = () => {
        if (!isPausingRef.current) {
          setIsListening(false);
        }
      };

      transcriberRef.current = transcriber;
      transcriber.startTranscribingAsync(
        () => setIsListening(true),
        (err: string) => {
          setError(`話者識別開始エラー: ${err}`);
          setIsListening(false);
        }
      );
    },
    [phraseList, sharedStream]
  );

  const startListening = useCallback((streamOverride?: MediaStream | null) => {
    if (!subscriptionKey || !region) {
      setError("Speech Services の設定がありません");
      return;
    }

    try {
      setError(null);
      setSegments([]);
      segmentIdRef.current = 0;
      setInterimTranscript("");
      startTimeRef.current = Date.now();

      // Issue #172: streamOverride > sharedStream > defaultMic の優先順位
      const activeStream = streamOverride ?? sharedStream;

      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
        subscriptionKey,
        region
      );
      speechConfig.speechRecognitionLanguage = language;

      if (enableSpeakerDiarization) {
        // ─── ConversationTranscriber モード ───
        startConversationTranscriber(speechConfig, activeStream);
      } else {
        // ─── SpeechRecognizer モード（従来） ───
        // Issue #172: activeStream が渡された場合は fromStreamInput を使用
        let audioConfig: SpeechSDK.AudioConfig;
        if (activeStream) {
          const { pushStream, cleanup } = createPushStreamFromMediaStream(activeStream);
          audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
          pushStreamCleanupRef.current = cleanup;
        } else {
          audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        }
        const recognizer = new SpeechSDK.SpeechRecognizer(
          speechConfig,
          audioConfig
        );

        // フレーズリスト適用（PhraseListGrammar で固有名詞・専門用語の認識精度向上）
        if (phraseList.length > 0) {
          const phraseListGrammar = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
          for (const phrase of phraseList) {
            phraseListGrammar.addPhrase(phrase);
          }
        }

        // 認識中（途中結果）
        recognizer.recognizing = (_sender, event) => {
          if (event.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
            setInterimTranscript(event.result.text);
          }
        };

        // 認識完了（確定結果）
        recognizer.recognized = (_sender, event) => {
          if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            const newText = event.result.text;

            setSegments((prev) => [
              ...prev,
              {
                id: `seg-${++segmentIdRef.current}`,
                text: newText,
                timestamp: Date.now() - startTimeRef.current,
              },
            ]);
            setInterimTranscript("");
          } else if (event.result.reason === SpeechSDK.ResultReason.NoMatch) {
            console.warn("Speech could not be recognized.");
          }
        };

        // エラー
        recognizer.canceled = (_sender, event) => {
          if (event.reason === SpeechSDK.CancellationReason.Error) {
            setError(`認識エラー: ${event.errorDetails}`);
          }
          setIsListening(false);
        };

        // セッション終了
        recognizer.sessionStopped = () => {
          if (!isPausingRef.current) {
            setIsListening(false);
          }
        };

        recognizerRef.current = recognizer;
        recognizer.startContinuousRecognitionAsync(
          () => {
            setIsListening(true);
          },
          (err) => {
            setError(`開始エラー: ${err}`);
            setIsListening(false);
          }
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`初期化エラー: ${message}`);
    }
  }, [subscriptionKey, region, language, enableSpeakerDiarization, startConversationTranscriber, phraseList, sharedStream]);

  const stopListening = useCallback(() => {
    isPausingRef.current = false;

    // Issue #167: PushStream のクリーンアップ
    if (pushStreamCleanupRef.current) {
      pushStreamCleanupRef.current();
      pushStreamCleanupRef.current = null;
    }

    if (enableSpeakerDiarization && transcriberRef.current) {
      transcriberRef.current.stopTranscribingAsync(
        () => {
          setIsListening(false);
          setIsPaused(false);
          transcriberRef.current?.close();
          transcriberRef.current = null;
          pausedTranscriptRef.current = "";
        },
        (err: string) => {
          setError(`停止エラー: ${err}`);
        }
      );
    } else if (recognizerRef.current) {
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsListening(false);
          setIsPaused(false);
          recognizerRef.current?.close();
          recognizerRef.current = null;
          pausedTranscriptRef.current = "";
        },
        (err) => {
          setError(`停止エラー: ${err}`);
        }
      );
    }
  }, [enableSpeakerDiarization]);

  const pauseListening = useCallback(() => {
    if (enableSpeakerDiarization && transcriberRef.current && isListening && !isPaused) {
      // ConversationTranscriber: pause API がないため停止→再作成で対応
      isPausingRef.current = true;
      transcriberRef.current.stopTranscribingAsync(
        () => {
          setIsPaused(true);
          setInterimTranscript("");
        },
        (err: string) => {
          isPausingRef.current = false;
          setError(`一時停止エラー: ${err}`);
        }
      );
    } else if (recognizerRef.current && isListening && !isPaused) {
      // SpeechRecognizer: 従来通り
      isPausingRef.current = true;
      pausedTranscriptRef.current = transcript;
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsPaused(true);
          setInterimTranscript("");
        },
        (err) => {
          isPausingRef.current = false;
          setError(`一時停止エラー: ${err}`);
        }
      );
    }
  }, [enableSpeakerDiarization, isListening, isPaused, transcript]);

  const resumeListening = useCallback(() => {
    if (enableSpeakerDiarization && isPaused) {
      // ConversationTranscriber: 新しいインスタンスを作成して再開
      // ⚠️ speakerId がリセットされる可能性あり
      isPausingRef.current = false;
      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(subscriptionKey, region);
      speechConfig.speechRecognitionLanguage = language;

      // 古いインスタンスをクリーンアップ
      if (transcriberRef.current) {
        transcriberRef.current.close();
        transcriberRef.current = null;
      }

      startConversationTranscriber(speechConfig);
      setIsPaused(false);
    } else if (recognizerRef.current && isPaused) {
      // SpeechRecognizer: 従来通り
      isPausingRef.current = false;
      recognizerRef.current.startContinuousRecognitionAsync(
        () => {
          setIsListening(true);
          setIsPaused(false);
        },
        (err) => {
          setError(`再開エラー: ${err}`);
        }
      );
    }
  }, [enableSpeakerDiarization, isPaused, subscriptionKey, region, language, startConversationTranscriber, phraseList]);

  const resetTranscript = useCallback(() => {
    setSegments([]);
    segmentIdRef.current = 0;
    setInterimTranscript("");
    pausedTranscriptRef.current = "";
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
    interimTranscript,
    error,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    resetTranscript,
    updateSegment,
  };
}
