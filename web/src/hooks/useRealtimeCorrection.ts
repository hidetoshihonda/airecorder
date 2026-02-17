/**
 * Issue #126: リアルタイムAI補正フック
 *
 * AI Cues (useAICues.ts) と同じ「バッチ + デバウンス + セッション上限」パターン。
 * 5セグメントごと / 3秒デバウンス / 1セッション50回上限で LLM 補正 API を呼び出す。
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LiveSegment } from "@/types";
import { correctionApi } from "@/services/correctionApi";

// ─── 設定定数 ───
const BATCH_SIZE = 5; // N セグメントごとに API 呼び出し
const DEBOUNCE_MS = 3000; // デバウンス間隔（3秒）
const MAX_CALLS_PER_SESSION = 50; // 1 録音セッションの上限
const CONTEXT_WINDOW = 10; // 直近 10 セグメントのみ送信

export interface UseRealtimeCorrectionOptions {
  segments: LiveSegment[];
  language: string;
  enabled: boolean;
  isRecording: boolean;
  phraseList?: string[];
  onCorrection: (
    corrections: Array<{ segmentId: string; correctedText: string }>
  ) => void;
}

export interface UseRealtimeCorrectionReturn {
  isCorrecting: boolean;
  correctionCount: number;
  correctedSegmentCount: number;
  error: string | null;
}

export function useRealtimeCorrection({
  segments,
  language,
  enabled,
  isRecording,
  phraseList = [],
  onCorrection,
}: UseRealtimeCorrectionOptions): UseRealtimeCorrectionReturn {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctionCount, setCorrectionCount] = useState(0);
  const [correctedSegmentCount, setCorrectedSegmentCount] = useState(0);

  // Refs for stable state across closures
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const onCorrectionRef = useRef(onCorrection);
  onCorrectionRef.current = onCorrection;

  const lastProcessedIndexRef = useRef(0);
  const callCountRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset on new recording session
  useEffect(() => {
    if (isRecording) {
      setError(null);
      setCorrectionCount(0);
      setCorrectedSegmentCount(0);
      lastProcessedIndexRef.current = 0;
      callCountRef.current = 0;
    }
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Core: fetch corrections from API
  const fetchCorrections = useCallback(
    async (targetSegments: LiveSegment[]) => {
      if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

      // Abort previous request if still pending
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsCorrecting(true);
      setError(null);
      callCountRef.current += 1;
      setCorrectionCount(callCountRef.current);

      try {
        const response = await correctionApi.correctSegments(
          {
            segments: targetSegments.map((s) => ({ id: s.id, text: s.text })),
            language,
            phraseList: phraseList.length > 0 ? phraseList : undefined,
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

        if (
          response.data?.corrections &&
          response.data.corrections.length > 0
        ) {
          const mappedCorrections = response.data.corrections.map((c) => ({
            segmentId: c.id,
            correctedText: c.corrected,
          }));
          onCorrectionRef.current(mappedCorrections);
          setCorrectedSegmentCount((prev) => prev + mappedCorrections.length);
        }
      } catch {
        // Network error — silent failure
      } finally {
        setIsCorrecting(false);
        abortControllerRef.current = null;
      }
    },
    [language, phraseList]
  );

  // Watch segments and trigger batch + debounce
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

    const newCount = segments.length - lastProcessedIndexRef.current;
    if (newCount < BATCH_SIZE) return;

    // Clear existing debounce
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      const current = segmentsRef.current;
      // 未補正セグメントのみ対象（直近 CONTEXT_WINDOW 件）
      const startIdx = Math.max(0, current.length - CONTEXT_WINDOW);
      const targetSegments = current
        .slice(startIdx)
        .filter((s) => !s.isCorrected);

      if (targetSegments.length > 0) {
        lastProcessedIndexRef.current = current.length;
        fetchCorrections(targetSegments);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [segments.length, enabled, isRecording, fetchCorrections]);

  // Abort on recording stop
  useEffect(() => {
    if (!isRecording) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    }
  }, [isRecording]);

  return {
    isCorrecting,
    correctionCount,
    correctedSegmentCount,
    error,
  };
}
