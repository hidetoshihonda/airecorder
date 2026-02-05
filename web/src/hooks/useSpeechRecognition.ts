"use client";

import { useCallback, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

interface UseSpeechRecognitionOptions {
  subscriptionKey: string;
  region: string;
  language?: string;
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions
): UseSpeechRecognitionReturn {
  const { subscriptionKey, region, language = "ja-JP" } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);

  const startListening = useCallback(() => {
    if (!subscriptionKey || !region) {
      setError("Speech Services の設定がありません");
      return;
    }

    try {
      setError(null);
      setTranscript("");
      setInterimTranscript("");

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
          setTranscript((prev) => {
            const newText = event.result.text;
            if (prev) {
              return prev + " " + newText;
            }
            return newText;
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
          recognizerRef.current?.close();
          recognizerRef.current = null;
        },
        (err) => {
          setError(`停止エラー: ${err}`);
        }
      );
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}
