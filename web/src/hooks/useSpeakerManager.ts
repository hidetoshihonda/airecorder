"use client";

import { useState, useCallback } from "react";
import { LiveSegment } from "@/types";

// Issue #140: 旧 localStorage エントリのクリーンアップ（ワンタイム）
if (typeof window !== "undefined") {
  try {
    if (!localStorage.getItem("airecorder-speaker-cleanup-v1")) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("airecorder-speaker-")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem("airecorder-speaker-cleanup-v1", "1");
    }
  } catch {
    // ignore
  }
}

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
  getSpeakerLabelsMap: () => Record<string, string>;
  updateFromSegments: (segments: LiveSegment[]) => void;
  resetSpeakers: () => void;
}

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
  }, []);

  const updateFromSegments = useCallback((segments: LiveSegment[]) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      let changed = false;

      // 新しい話者を検出
      for (const seg of segments) {
        if (seg.speaker && !next.has(seg.speaker)) {
          next.set(seg.speaker, {
            id: seg.speaker,
            label: seg.speaker,
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

  // Issue #140: speakers Map からリネームされたラベルのみ抽出
  const getSpeakerLabelsMap = useCallback((): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const [id, info] of speakers) {
      if (info.label !== id) {
        map[id] = info.label;
      }
    }
    return map;
  }, [speakers]);

  const resetSpeakers = useCallback(() => {
    setSpeakers(new Map());
  }, []);

  return { speakers, renameSpeaker, getSpeakerLabel, getSpeakerLabelsMap, updateFromSegments, resetSpeakers };
}
