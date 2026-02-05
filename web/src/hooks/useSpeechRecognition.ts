"use client";

import { useCallback, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

interface UseSpeechRecognitionOptions {
  subscriptionKey: string;
  region: string;
  language?: string;
  enableSpeakerDiarization?: boolean;
}

interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isPaused: boolean;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions
): UseSpeechRecognitionReturn {
  const { subscriptionKey, region, language = "ja-JP", enableSpeakerDiarization = false } = options;

  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const speechConfigRef = useRef<SpeechSDK.SpeechConfig | null>(null);
  const pausedTranscriptRef = useRef<string>("");
  const startTimeRef = useRef<number>(0);
  const currentSpeakerRef = useRef<string>("話者1");
  const lastSpeechEndRef = useRef<number>(0);
  const SPEAKER_CHANGE_THRESHOLD = 2000; // 2秒以上の沈黙で話者切り替えの可能性

  const startListening = useCallback(() => {
    if (!subscriptionKey || !region) {
      setError("Speech Services の設定がありません");
      return;
    }

    try {
      setError(null);
      setTranscript("");
      setTranscriptSegments([]);
      setInterimTranscript("");
      startTimeRef.current = Date.now();
      currentSpeakerRef.current = "話者1";
      lastSpeechEndRef.current = Date.now();

      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
        subscriptionKey,
        region
      );
      speechConfig.speechRecognitionLanguage = language;

      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new SpeechSDK.SpeechRecognizer(
        speechConfig,
        audioConfig
      );

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
          const now = Date.now();
          
          // 話者識別が有効な場合、沈黙時間で話者切り替えを検出
          if (enableSpeakerDiarization) {
            const silenceDuration = now - lastSpeechEndRef.current;
            if (silenceDuration > SPEAKER_CHANGE_THRESHOLD) {
              // 話者を切り替え（最大4人まで）
              const currentNum = parseInt(currentSpeakerRef.current.replace("話者", ""));
              const nextNum = currentNum >= 4 ? 1 : currentNum + 1;
              currentSpeakerRef.current = `話者${nextNum}`;
            }
            lastSpeechEndRef.current = now;
            
            // セグメントを追加
            const segment: TranscriptSegment = {
              speaker: currentSpeakerRef.current,
              text: newText,
              timestamp: now - startTimeRef.current,
            };
            setTranscriptSegments((prev) => [...prev, segment]);
          }
          
          setTranscript((prev) => {
            if (enableSpeakerDiarization) {
              // 話者ラベル付きのテキスト
              const label = `[${currentSpeakerRef.current}] `;
              if (prev) {
                return prev + "\n" + label + newText;
              }
              return label + newText;
            } else {
              if (prev) {
                return prev + " " + newText;
              }
              return newText;
            }
          });
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
        setIsListening(false);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`初期化エラー: ${message}`);
    }
  }, [subscriptionKey, region, language]);

  const stopListening = useCallback(() => {
    if (recognizerRef.current) {
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
  }, []);

  const pauseListening = useCallback(() => {
    if (recognizerRef.current && isListening && !isPaused) {
      // 現在のtranscriptを保存
      pausedTranscriptRef.current = transcript;
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setIsPaused(true);
          setInterimTranscript("");
        },
        (err) => {
          setError(`一時停止エラー: ${err}`);
        }
      );
    }
  }, [isListening, isPaused, transcript]);

  const resumeListening = useCallback(() => {
    if (recognizerRef.current && isListening && isPaused) {
      recognizerRef.current.startContinuousRecognitionAsync(
        () => {
          setIsPaused(false);
        },
        (err) => {
          setError(`再開エラー: ${err}`);
        }
      );
    }
  }, [isListening, isPaused]);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setTranscriptSegments([]);
    setInterimTranscript("");
    pausedTranscriptRef.current = "";
    currentSpeakerRef.current = "話者1";
  }, []);

  return {
    isListening,
    isPaused,
    transcript,
    transcriptSegments,
    interimTranscript,
    error,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    resetTranscript,
  };
}
