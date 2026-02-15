"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AICue, LiveSegment } from "@/types";
import { cuesApi } from "@/services/cuesApi";

// ─── 設定定数 ───
const BATCH_SIZE = 5; // N セグメントごとにAPI呼び出し
const DEBOUNCE_MS = 5000; // デバウンス間隔（5秒）
const MAX_CALLS_PER_SESSION = 20; // 1録音セッションの上限
const CONTEXT_WINDOW = 20; // 直近20セグメントのみ送信

export interface UseAICuesOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  enabled: boolean;
  isRecording: boolean;
}

export interface UseAICuesReturn {
  cues: AICue[];
  isLoading: boolean;
  error: string | null;
  callCount: number;
  clearCues: () => void;
}

export function useAICues({
  segments,
  sourceLanguage,
  enabled,
  isRecording,
}: UseAICuesOptions): UseAICuesReturn {
  const [cues, setCues] = useState<AICue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callCount, setCallCount] = useState(0);

  // Refs for stable state across closures
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const lastProcessedIndexRef = useRef(0);
  const callCountRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cueIdCounterRef = useRef(0);

  // Reset on new recording session
  useEffect(() => {
    if (isRecording) {
      setCues([]);
      setError(null);
      setCallCount(0);
      lastProcessedIndexRef.current = 0;
      callCountRef.current = 0;
      cueIdCounterRef.current = 0;
    }
  }, [isRecording]);

  // Cleanup on unmount or recording stop
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Core: fetch AI Cues from API
  const fetchCues = useCallback(
    async (segmentTexts: string[]) => {
      if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

      // Abort previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);
      callCountRef.current += 1;
      setCallCount(callCountRef.current);

      try {
        const response = await cuesApi.generateCues(
          {
            segments: segmentTexts,
            language: sourceLanguage,
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

        if (response.data?.cues && response.data.cues.length > 0) {
          const now = Date.now();
          const newCues: AICue[] = response.data.cues.map((raw) => {
            const id = `cue-${++cueIdCounterRef.current}`;
            const base = {
              id,
              timestamp: now,
              segmentIndex: segmentsRef.current.length - 1,
            };

            switch (raw.type) {
              case "concept":
                return {
                  ...base,
                  type: "concept" as const,
                  term: raw.term || "",
                  definition: raw.definition || "",
                  context: raw.context,
                };
              case "bio":
                return {
                  ...base,
                  type: "bio" as const,
                  name: raw.name || "",
                  description: raw.description || "",
                  role: raw.role,
                };
              case "suggestion":
                return {
                  ...base,
                  type: "suggestion" as const,
                  question: raw.question || "",
                  suggestion: raw.suggestion || "",
                  reasoning: raw.reasoning,
                };
              default:
                return {
                  ...base,
                  type: "concept" as const,
                  term: "Unknown",
                  definition: "",
                };
            }
          });

          setCues((prev) => [...prev, ...newCues]);
        }
      } catch {
        // Network error, etc.
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [sourceLanguage]
  );

  // Watch segments and trigger batch + debounce
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

    const newCount = segments.length - lastProcessedIndexRef.current;
    if (newCount < BATCH_SIZE) return;

    // Clear existing debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const currentSegments = segmentsRef.current;
      const startIdx = Math.max(0, currentSegments.length - CONTEXT_WINDOW);
      const segmentTexts = currentSegments.slice(startIdx).map((s) => s.text);

      lastProcessedIndexRef.current = currentSegments.length;
      fetchCues(segmentTexts);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [segments.length, enabled, isRecording, fetchCues]);

  // Abort on recording stop
  useEffect(() => {
    if (!isRecording) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    }
  }, [isRecording]);

  const clearCues = useCallback(() => {
    setCues([]);
    setError(null);
    setCallCount(0);
    lastProcessedIndexRef.current = 0;
    callCountRef.current = 0;
  }, []);

  return {
    cues,
    isLoading,
    error,
    callCount,
    clearCues,
  };
}
