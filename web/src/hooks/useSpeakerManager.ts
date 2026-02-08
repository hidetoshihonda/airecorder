"use client";

import { useState, useCallback } from "react";
import { LiveSegment } from "@/types";

export interface SpeakerInfo {
  /** SDK が返す話者 ID（例: "Guest-1"） */
  id: string;
  /** ユーザー設定の表示名（例: "田中さん"） */
  label: string;
  /** カラーパレットのインデックス */
  color: number;
  /** 発話回数 */
  segmentCount: number;
}

interface UseSpeakerManagerReturn {
  speakers: Map<string, SpeakerInfo>;
  renameSpeaker: (id: string, label: string) => void;
  getSpeakerLabel: (id: string) => string;
  updateFromSegments: (segments: LiveSegment[]) => void;
  resetSpeakers: () => void;
}

const STORAGE_PREFIX = "airecorder-speaker-";

export function useSpeakerManager(): UseSpeakerManagerReturn {
  const [speakers, setSpeakers] = useState<Map<string, SpeakerInfo>>(new Map());

  const renameSpeaker = useCallback((id: string, label: string) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      const info = next.get(id);
      if (info) {
        next.set(id, { ...info, label });
      }
      return next;
    });
    // LocalStorage に永続化
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, label);
    } catch {
      // Storage quota exceeded — ignore
    }
  }, []);

  const updateFromSegments = useCallback((segments: LiveSegment[]) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      let changed = false;

      // 新しい話者を検出
      for (const seg of segments) {
        if (seg.speaker && !next.has(seg.speaker)) {
          let saved: string | null = null;
          try {
            saved = localStorage.getItem(`${STORAGE_PREFIX}${seg.speaker}`);
          } catch {
            // ignore
          }
          next.set(seg.speaker, {
            id: seg.speaker,
            label: saved || seg.speaker,
            color: next.size,
            segmentCount: 0,
          });
          changed = true;
        }
      }

      // segmentCount を更新
      const counts = new Map<string, number>();
      for (const seg of segments) {
        if (seg.speaker) {
          counts.set(seg.speaker, (counts.get(seg.speaker) || 0) + 1);
        }
      }
      for (const [id, info] of next) {
        const count = counts.get(id) || 0;
        if (info.segmentCount !== count) {
          next.set(id, { ...info, segmentCount: count });
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, []);

  const getSpeakerLabel = useCallback(
    (id: string) => {
      return speakers.get(id)?.label || id;
    },
    [speakers]
  );

  const resetSpeakers = useCallback(() => {
    setSpeakers(new Map());
  }, []);

  return { speakers, renameSpeaker, getSpeakerLabel, updateFromSegments, resetSpeakers };
}
