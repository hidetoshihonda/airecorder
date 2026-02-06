"use client";

import { useCallback, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

interface UseTextToSpeechOptions {
  subscriptionKey: string;
  region: string;
}

interface UseTextToSpeechReturn {
  isSpeaking: boolean;
  error: string | null;
  speak: (text: string, language: string) => Promise<void>;
  stop: () => void;
}

// Language code to voice name mapping
const VOICE_MAP: Record<string, string> = {
  "ja-JP": "ja-JP-NanamiNeural",
  "en-US": "en-US-JennyNeural",
  "zh-CN": "zh-CN-XiaoxiaoNeural",
  "ko-KR": "ko-KR-SunHiNeural",
  "es-ES": "es-ES-ElviraNeural",
  "fr-FR": "fr-FR-DeniseNeural",
  "de-DE": "de-DE-KatjaNeural",
  "pt-BR": "pt-BR-FranciscaNeural",
  "it-IT": "it-IT-ElsaNeural",
  "ar-SA": "ar-SA-ZariyahNeural",
};

export function useTextToSpeech(
  options: UseTextToSpeechOptions
): UseTextToSpeechReturn {
  const { subscriptionKey, region } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const synthesizerRef = useRef<SpeechSDK.SpeechSynthesizer | null>(null);
  const playerRef = useRef<SpeechSDK.SpeakerAudioDestination | null>(null);

  const speak = useCallback(
    async (text: string, language: string): Promise<void> => {
      if (!subscriptionKey || !region) {
        setError("Speech Services の設定がありません");
        return;
      }

      if (!text.trim()) {
        return;
      }

      // Stop any ongoing speech
      if (synthesizerRef.current) {
        synthesizerRef.current.close();
        synthesizerRef.current = null;
      }

      try {
        setError(null);
        setIsSpeaking(true);

        const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
          subscriptionKey,
          region
        );

        // Set the voice based on language
        const voiceName = VOICE_MAP[language] || VOICE_MAP["en-US"];
        speechConfig.speechSynthesisVoiceName = voiceName;

        // Create audio output
        const player = new SpeechSDK.SpeakerAudioDestination();
        playerRef.current = player;
        const audioConfig = SpeechSDK.AudioConfig.fromSpeakerOutput(player);

        const synthesizer = new SpeechSDK.SpeechSynthesizer(
          speechConfig,
          audioConfig
        );
        synthesizerRef.current = synthesizer;

        return new Promise((resolve, reject) => {
          synthesizer.speakTextAsync(
            text,
            (result) => {
              if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                setIsSpeaking(false);
                resolve();
              } else {
                const errorMsg = `音声合成エラー: ${SpeechSDK.ResultReason[result.reason]}`;
                setError(errorMsg);
                setIsSpeaking(false);
                reject(new Error(errorMsg));
              }
              synthesizer.close();
              synthesizerRef.current = null;
            },
            (err) => {
              const errorMsg = `音声合成エラー: ${err}`;
              setError(errorMsg);
              setIsSpeaking(false);
              synthesizer.close();
              synthesizerRef.current = null;
              reject(new Error(errorMsg));
            }
          );
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(`TTS エラー: ${message}`);
        setIsSpeaking(false);
      }
    },
    [subscriptionKey, region]
  );

  const stop = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.close();
      playerRef.current = null;
    }
    if (synthesizerRef.current) {
      synthesizerRef.current.close();
      synthesizerRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  return {
    isSpeaking,
    error,
    speak,
    stop,
  };
}
