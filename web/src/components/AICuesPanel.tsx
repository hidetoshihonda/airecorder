"use client";

import { memo, useRef, useEffect, useState } from "react";
import {
  Lightbulb,
  User,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AICue, ConceptCue, BioCue, SuggestionCue } from "@/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// ─── CueCard コンポーネント ───

const ConceptCard = memo(function ConceptCard({ cue }: { cue: ConceptCue }) {
  const t = useTranslations("AICues");
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-bold text-amber-800 dark:text-amber-300">
          {t("concept")}
        </span>
      </div>
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
        {cue.term}
      </p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {cue.definition}
      </p>
      {cue.context && (
        <p className="mt-1 text-xs italic text-gray-400 dark:text-gray-500">
          💬 {cue.context}
        </p>
      )}
    </div>
  );
});

const BioCard = memo(function BioCard({ cue }: { cue: BioCue }) {
  const t = useTranslations("AICues");
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
      <div className="mb-1 flex items-center gap-2">
        <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-bold text-blue-800 dark:text-blue-300">
          {t("bio")}
        </span>
      </div>
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
        {cue.name}
      </p>
      {cue.role && (
        <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-400">
          {cue.role}
        </p>
      )}
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {cue.description}
      </p>
    </div>
  );
});

const SuggestionCard = memo(function SuggestionCard({
  cue,
}: {
  cue: SuggestionCue;
}) {
  const t = useTranslations("AICues");
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
      <div className="mb-1 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
        <span className="text-xs font-bold text-green-800 dark:text-green-300">
          {t("suggestion")}
        </span>
      </div>
      <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
        ❓ {cue.question}
      </p>
      <p className="text-sm text-gray-800 dark:text-gray-200">
        {cue.suggestion}
      </p>
      {cue.reasoning && (
        <p className="mt-1 text-xs italic text-gray-400 dark:text-gray-500">
          📎 {cue.reasoning}
        </p>
      )}
    </div>
  );
});

function CueCard({ cue }: { cue: AICue }) {
  switch (cue.type) {
    case "concept":
      return <ConceptCard cue={cue} />;
    case "bio":
      return <BioCard cue={cue} />;
    case "suggestion":
      return <SuggestionCard cue={cue} />;
  }
}

// ─── AICuesPanel メインコンポーネント ───

interface AICuesPanelProps {
  cues: AICue[];
  isLoading: boolean;
  error: string | null;
  callCount: number;
  isRecording: boolean;
  enabled: boolean;
}

export function AICuesPanel({
  cues,
  isLoading,
  error,
  callCount,
  isRecording,
  enabled,
}: AICuesPanelProps) {
  const t = useTranslations("AICues");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-scroll to latest cue
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [cues.length]);

  if (!enabled) return null;

  // Collapsed state — show toggle button only
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className={cn(
          "flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-3 shadow-sm transition-colors hover:bg-gray-50",
          "dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
        )}
        title={t("expandPanel")}
      >
        <ChevronLeft className="h-4 w-4 text-gray-500" />
        <Sparkles className="h-4 w-4 text-purple-500" />
        {cues.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700 dark:bg-purple-900 dark:text-purple-300">
            {cues.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
        "dark:border-gray-700 dark:bg-gray-800",
        "lg:w-70 xl:w-80"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("title")}
          </span>
          {isLoading && <Spinner className="h-3 w-3" />}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">{callCount}/20</span>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            title={t("collapsePanel")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Cue List */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-3"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        {error && (
          <div className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <X className="h-3 w-3" />
            {error}
          </div>
        )}

        {cues.length === 0 && !isLoading && isRecording && (
          <div className="py-8 text-center text-xs text-gray-400">
            <Sparkles className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p>{t("waitingForCues")}</p>
            <p className="mt-1 text-gray-300 dark:text-gray-600">
              {t("waitingDescription")}
            </p>
          </div>
        )}

        {cues.length === 0 && !isRecording && (
          <div className="py-8 text-center text-xs text-gray-400">
            <p>{t("noRecording")}</p>
          </div>
        )}

        {cues.map((cue) => (
          <CueCard key={cue.id} cue={cue} />
        ))}

        {isLoading && cues.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-400">
            <Spinner className="h-3 w-3" />
            {t("analyzing")}
          </div>
        )}
      </div>
    </div>
  );
}
