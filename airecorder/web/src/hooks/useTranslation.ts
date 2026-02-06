"use client";

import { useState, useCallback } from "react";

interface UseTranslationOptions {
  subscriptionKey: string;
  region?: string;
  endpoint?: string;
}

interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
}

interface UseTranslationReturn {
  isTranslating: boolean;
  translation: TranslationResult | null;
  error: string | null;
  translate: (text: string, from: string, to: string) => Promise<string | null>;
  reset: () => void;
}

export function useTranslation(
  options: UseTranslationOptions
): UseTranslationReturn {
  const {
    subscriptionKey,
    region = "japaneast",
    endpoint = "https://api.cognitive.microsofttranslator.com",
  } = options;

  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const translate = useCallback(
    async (
      text: string,
      from: string,
      to: string
    ): Promise<string | null> => {
      if (!subscriptionKey) {
        setError("Translator の設定がありません");
        return null;
      }

      if (!text.trim()) {
        return null;
      }

      setIsTranslating(true);
      setError(null);

      try {
        // 言語コードを変換（ja-JP → ja, en-US → en）
        const fromLang = from.split("-")[0];
        const toLang = to.split("-")[0];

        const response = await fetch(
          `${endpoint}/translate?api-version=3.0&from=${fromLang}&to=${toLang}`,
          {
            method: "POST",
            headers: {
              "Ocp-Apim-Subscription-Key": subscriptionKey,
              "Ocp-Apim-Subscription-Region": region,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([{ text }]),
          }
        );

        if (!response.ok) {
          throw new Error(`翻訳エラー: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const translatedText = data[0]?.translations[0]?.text || "";

        const result: TranslationResult = {
          originalText: text,
          translatedText,
          sourceLanguage: from,
          targetLanguage: to,
        };

        setTranslation(result);
        setIsTranslating(false);
        return translatedText;
      } catch (err) {
        const message = err instanceof Error ? err.message : "翻訳に失敗しました";
        setError(message);
        setIsTranslating(false);
        return null;
      }
    },
    [subscriptionKey, region, endpoint]
  );

  const reset = useCallback(() => {
    setTranslation(null);
    setError(null);
  }, []);

  return {
    isTranslating,
    translation,
    error,
    translate,
    reset,
  };
}
