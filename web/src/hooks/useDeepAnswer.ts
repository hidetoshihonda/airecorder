"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnswerCue, Citation, LiveSegment } from "@/types";
import { cuesApi } from "@/services/cuesApi";

// ─── 設定定数 ───
const MAX_DEEP_ANSWERS_PER_SESSION = 10;
const DEBOUNCE_MS = 3000;
const QUESTION_CHECK_INTERVAL = 3; // 3セグメントごとに質問チェック

// ─── 質問検出パターン ───
const QUESTION_PATTERNS_JA = [
  /(.{5,})(?:とは|って)(?:何|なん)(?:ですか|でしょうか|だ)?[？?]?/,
  /(.{5,})(?:について)(?:教えて|説明して)[くください]*/,
  /(.{5,})(?:の違い|の差|の比較)(?:は|を)(?:何|教えて|説明)/,
  /(.{5,})(?:どう(?:やって|すれば|したら))/,
  /(.{5,})(?:の仕組み|のメカニズム|の原理)(?:は|を)/,
  /(.{5,})(?:のベストプラクティス|の推奨)/,
  /(.{5,})(?:エラー|問題|バグ|障害).*(?:原因|解決|対処|対応)/,
];

const QUESTION_PATTERNS_EN = [
  /what (?:is|are|does) (.{5,})[?？]?/i,
  /how (?:to|do|does|can|should) (.{5,})[?？]?/i,
  /(?:can you |could you |please )?explain (.{5,})/i,
  /what(?:'s| is) the difference between (.{5,})/i,
  /why (?:does|is|are|do) (.{5,})[?？]?/i,
  /(?:what|which) (?:is|are) the best (?:practice|way) (.{5,})/i,
];

function detectQuestion(text: string, language: string): string | null {
  const patterns = language.startsWith("ja")
    ? QUESTION_PATTERNS_JA
    : QUESTION_PATTERNS_EN;

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return text; // 質問全体を返す
    }
  }

  // 末尾が ? で終わる場合も質問とみなす
  if (text.trim().endsWith("?") || text.trim().endsWith("？")) {
    return text;
  }

  return null;
}

// ─── Hook Options / Return ───

export interface UseDeepAnswerOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  mode: "tech_support" | "interview" | "general";
  enabled: boolean;
  isRecording: boolean;
}

export interface UseDeepAnswerReturn {
  answers: AnswerCue[];
  isSearching: boolean;
  error: string | null;
  answerCount: number;
  triggerDeepAnswer: (question: string) => void;
  clearAnswers: () => void;
}

// ─── Hook 実装 ───

export function useDeepAnswer({
  segments,
  sourceLanguage,
  mode,
  enabled,
  isRecording,
}: UseDeepAnswerOptions): UseDeepAnswerReturn {
  const [answers, setAnswers] = useState<AnswerCue[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerCount, setAnswerCount] = useState(0);

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const lastCheckedIndexRef = useRef(0);
  const answerCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const answerIdCounterRef = useRef(0);
  const processedQuestionsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on new recording session
  useEffect(() => {
    if (isRecording) {
      setAnswers([]);
      setError(null);
      setAnswerCount(0);
      lastCheckedIndexRef.current = 0;
      answerCountRef.current = 0;
      answerIdCounterRef.current = 0;
      processedQuestionsRef.current = new Set();
    }
  }, [isRecording]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Core: fetch deep answer
  const fetchDeepAnswer = useCallback(
    async (question: string) => {
      if (answerCountRef.current >= MAX_DEEP_ANSWERS_PER_SESSION) return;

      // 重複質問を防止（正規化して比較）
      const normalizedQ = question.trim().toLowerCase();
      if (processedQuestionsRef.current.has(normalizedQ)) return;
      processedQuestionsRef.current.add(normalizedQ);

      // 前のリクエストをキャンセル
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsSearching(true);
      setError(null);
      answerCountRef.current += 1;
      setAnswerCount(answerCountRef.current);

      try {
        const currentSegments = segmentsRef.current;
        const contextTexts = currentSegments.slice(-10).map((s) => s.text);

        const response = await cuesApi.deepAnswer(
          {
            question,
            segments: contextTexts,
            language: sourceLanguage,
            mode,
          },
          controller.signal
        );

        if (controller.signal.aborted) return;

        if (response.error) {
          if (response.error !== "REQUEST_ABORTED") {
            setError(response.error);
          }
          return;
        }

        if (response.data) {
          const newAnswer: AnswerCue = {
            id: `answer-${++answerIdCounterRef.current}`,
            type: "answer",
            timestamp: Date.now(),
            segmentIndex: currentSegments.length - 1,
            question,
            answer: response.data.answer,
            citations: response.data.citations as Citation[],
            mode,
          };

          setAnswers((prev) => [...prev, newAnswer]);
        }
      } catch {
        // Network error — silently ignored
      } finally {
        setIsSearching(false);
        abortControllerRef.current = null;
      }
    },
    [sourceLanguage, mode]
  );

  // 手動トリガー（外部から質問を指定して検索）
  const triggerDeepAnswer = useCallback(
    (question: string) => {
      if (!enabled || !question.trim()) return;
      fetchDeepAnswer(question);
    },
    [enabled, fetchDeepAnswer]
  );

  // 自動質問検出: segments を監視してパターンマッチ
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (answerCountRef.current >= MAX_DEEP_ANSWERS_PER_SESSION) return;

    const newCount = segments.length - lastCheckedIndexRef.current;
    if (newCount < QUESTION_CHECK_INTERVAL) return;

    // 直近のセグメントから質問を検出
    const recentSegments = segments.slice(lastCheckedIndexRef.current);
    lastCheckedIndexRef.current = segments.length;

    for (const seg of recentSegments) {
      const question = detectQuestion(seg.text, sourceLanguage);
      if (question) {
        // デバウンスして質問を処理
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          fetchDeepAnswer(question);
        }, DEBOUNCE_MS);
        break; // 1回の検出で1つだけ処理
      }
    }
  }, [segments.length, enabled, isRecording, sourceLanguage, fetchDeepAnswer]);

  // Abort on recording stop
  useEffect(() => {
    if (!isRecording) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    }
  }, [isRecording]);

  const clearAnswers = useCallback(() => {
    setAnswers([]);
    setError(null);
    setAnswerCount(0);
    lastCheckedIndexRef.current = 0;
    answerCountRef.current = 0;
    processedQuestionsRef.current = new Set();
  }, []);

  return {
    answers,
    isSearching,
    error,
    answerCount,
    triggerDeepAnswer,
    clearAnswers,
  };
}
