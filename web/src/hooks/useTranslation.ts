"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { LiveSegment, TranslatedSegment } from "@/types";

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
  // Issue #33: セグメント単位の差分翻訳
  translatedSegments: TranslatedSegment[];
  translatedFullText: string;
  interimTranslation: string;
  translateSegment: (segment: LiveSegment, from: string, to: string) => Promise<void>;
  translateInterim: (text: string, from: string, to: string) => Promise<void>;
  resetSegments: () => void;
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

  // Issue #33: セグメント単位の差分翻訳
  const translatedIdsRef = useRef<Set<string>>(new Set());
  const [translatedSegments, setTranslatedSegments] = useState<TranslatedSegment[]>([]);
  const [interimTranslation, setInterimTranslation] = useState("");

  // 翻訳済みセグメントを結合した全文
  const translatedFullText = useMemo(
    () => translatedSegments.map((s) => s.translatedText).join(" "),
    [translatedSegments]
  );

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
          let errorMessage = `翻訳エラー: ${response.status} ${response.statusText}`;
          try {
            const errorBody = await response.json();
            if (errorBody?.error?.message) {
              if (response.status === 401 || response.status === 403 ||
                  errorBody.error.message.toLowerCase().includes('quota')) {
                errorMessage = '翻訳サービスの利用制限に達しました。しばらく経ってから再度お試しください。';
              } else {
                errorMessage = `翻訳エラー: ${errorBody.error.message}`;
              }
            }
          } catch {
            // JSONパースエラーはデフォルトメッセージを使用
          }
          throw new Error(errorMessage);
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

  // Issue #33: 個別セグメントの翻訳（キャッシュ付き）
  const translateSegment = useCallback(
    async (segment: LiveSegment, from: string, to: string) => {
      // 翻訳済みならスキップ
      if (translatedIdsRef.current.has(segment.id)) return;
      translatedIdsRef.current.add(segment.id);

      const result = await translate(segment.text, from, to);
      if (result) {
        setTranslatedSegments((prev) => [
          ...prev,
          {
            segmentId: segment.id,
            originalText: segment.text,
            translatedText: result,
            speaker: segment.speaker,
            speakerLabel: segment.speakerLabel,
          },
        ]);
      } else {
        // 翻訳失敗時はキャッシュから除外（リトライ可能に）
        translatedIdsRef.current.delete(segment.id);
      }
    },
    [translate]
  );

  // Issue #33: 中間結果（interim）の翻訳
  const translateInterim = useCallback(
    async (text: string, from: string, to: string) => {
      const result = await translate(text, from, to);
      if (result) {
        setInterimTranslation(result);
      }
    },
    [translate]
  );

  // Issue #33: セグメント翻訳状態のリセット
  const resetSegments = useCallback(() => {
    translatedIdsRef.current.clear();
    setTranslatedSegments([]);
    setInterimTranslation("");
  }, []);

  return {
    isTranslating,
    translation,
    error,
    translate,
    reset,
    // Issue #33
    translatedSegments,
    translatedFullText,
    interimTranslation,
    translateSegment,
    translateInterim,
    resetSegments,
  };
}
