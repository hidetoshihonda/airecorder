"use client";

import { useRef, useEffect, useCallback, useState, memo } from "react";
import { ArrowDown } from "lucide-react";
import { LiveSegment } from "@/types";

// ─── 話者カラーパレット ───
const SPEAKER_COLORS = [
  { bg: "bg-blue-50", border: "border-l-blue-400", label: "text-blue-700" },
  { bg: "bg-green-50", border: "border-l-green-400", label: "text-green-700" },
  { bg: "bg-purple-50", border: "border-l-purple-400", label: "text-purple-700" },
  { bg: "bg-orange-50", border: "border-l-orange-400", label: "text-orange-700" },
  { bg: "bg-pink-50", border: "border-l-pink-400", label: "text-pink-700" },
  { bg: "bg-cyan-50", border: "border-l-cyan-400", label: "text-cyan-700" },
  { bg: "bg-yellow-50", border: "border-l-yellow-400", label: "text-yellow-700" },
  { bg: "bg-red-50", border: "border-l-red-400", label: "text-red-700" },
] as const;

function getSpeakerColorIndex(speakerId: string): number {
  const match = speakerId.match(/(\d+)/);
  if (match) return (parseInt(match[1]) - 1) % SPEAKER_COLORS.length;
  // Unknown / non-numeric: hash to index
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = (hash * 31 + speakerId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SPEAKER_COLORS.length;
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// ─── 個別セグメント（memo で再描画を防止） ───

const SegmentItem = memo(function SegmentItem({
  segment,
  showSpeaker,
}: {
  segment: LiveSegment;
  showSpeaker: boolean;
}) {
  if (!showSpeaker || !segment.speaker) {
    // 話者なしモード: インラインテキスト
    return <span className="inline">{segment.text} </span>;
  }

  // 話者ありモード: バブル表示
  const color = SPEAKER_COLORS[getSpeakerColorIndex(segment.speaker)];
  const label = segment.speakerLabel || segment.speaker;

  return (
    <div className={`rounded-md p-3 mb-2 border-l-4 ${color.bg} ${color.border}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-bold ${color.label}`}>{label}</span>
        {segment.timestamp !== undefined && (
          <span className="text-xs text-gray-400">
            {formatTimestamp(segment.timestamp)}
          </span>
        )}
      </div>
      <p className="text-gray-800 text-sm">{segment.text}</p>
    </div>
  );
});

// ─── TranscriptView メインコンポーネント ───

interface TranscriptViewProps {
  segments: LiveSegment[];
  interimTranscript: string;
  showSpeaker: boolean;
  isRecording: boolean;
  maxHeight?: string;
}

export function TranscriptView({
  segments,
  interimTranscript,
  showSpeaker,
  isRecording,
  maxHeight = "400px",
}: TranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  // Auto-scroll with rAF (segments.length 変化で発火)
  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [segments.length, interimTranscript, autoFollow]);

  // Reset autoFollow when recording starts
  useEffect(() => {
    if (isRecording) {
      setAutoFollow(true);
    }
  }, [isRecording]);

  // Manual scroll detection
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (!isAtBottom && autoFollow) {
        setAutoFollow(false);
      }
    },
    [autoFollow]
  );

  const hasSpeakers = showSpeaker && segments.some((s) => s.speaker);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ maxHeight }}
        className="overflow-y-auto"
      >
        {segments.length > 0 && (
          <div
            className={
              hasSpeakers
                ? "space-y-0"
                : "whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800"
            }
          >
            {segments.map((seg) => (
              <SegmentItem key={seg.id} segment={seg} showSpeaker={hasSpeakers} />
            ))}
          </div>
        )}

        {interimTranscript && (
          <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-blue-600 italic mt-1">
            {interimTranscript}
          </div>
        )}

        {/* Scroll anchor for overflow-anchor */}
        <div ref={anchorRef} className="h-px" style={{ overflowAnchor: "auto" }} />
      </div>

      {/* Follow toggle button */}
      {!autoFollow && (
        <div className="flex justify-center mt-2">
          <button
            onClick={() => setAutoFollow(true)}
            className="flex items-center gap-1 rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowDown className="h-4 w-4" />
            最新に追従
          </button>
        </div>
      )}
    </div>
  );
}
