"use client";

import { memo, useRef, useEffect, useState } from "react";
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  X,
  ExternalLink,
  Copy,
  Check,
  HelpCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AICue, QuestionCue, AnswerCue } from "@/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// ─── CueCard コンポーネント ───

// ─── QuestionCue Card ───

const QuestionCard = memo(function QuestionCard({ cue }: { cue: QuestionCue }) {
  const t = useTranslations("AICues");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`Q: ${cue.question}\nA: ${cue.answer}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
            {t("questionDetected")}
          </span>
          {cue.confidence === "medium" && (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              {t("estimated")}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-900"
          title={t("copyAnswer")}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <p className="mb-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
        ❓ {cue.question}
      </p>
      <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
        {cue.answer}
      </p>
    </div>
  );
});

const AnswerCard = memo(function AnswerCard({ cue }: { cue: AnswerCue }) {
  const t = useTranslations("AICues");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const handleCopy = () => {
    const text = `${cue.question}\n\n${cue.answer}\n\n引用:\n${cue.citations
      .map((c, i) => `[${i + 1}] ${c.title}: ${c.url}`)
      .join("\n")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const modeLabel = {
    tech_support: "💼 Tech Support",
    interview: "🎤 Interview",
    general: "💡 General",
  }[cue.mode];

  return (
    <div className="rounded-lg border-2 border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-950">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <span className="text-xs font-bold text-purple-800 dark:text-purple-300">
            {t("deepAnswer")}
          </span>
          <span className="rounded-full bg-purple-200 px-2 py-0.5 text-[10px] text-purple-700 dark:bg-purple-800 dark:text-purple-300">
            {modeLabel}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-900"
          title={t("copyAnswer")}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Question */}
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
        ❓ {cue.question}
      </p>

      {/* Answer */}
      <div
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200",
          !expanded && "line-clamp-4"
        )}
      >
        {cue.answer}
      </div>

      {cue.answer.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-purple-600 hover:underline dark:text-purple-400"
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      )}

      {/* Citations */}
      {cue.citations.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-purple-200 pt-2 dark:border-purple-700">
          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
            📎 {t("citations")} ({cue.citations.length})
          </p>
          {cue.citations.map((citation, index) => (
            <a
              key={index}
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-purple-100 dark:hover:bg-purple-900"
            >
              <span className="mt-0.5 flex-shrink-0 rounded bg-purple-200 px-1 text-[10px] font-bold text-purple-700 dark:bg-purple-800 dark:text-purple-300">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-purple-700 dark:text-purple-400">
                  {citation.title}
                </p>
                <p className="truncate text-gray-400">
                  {(() => {
                    try {
                      return new URL(citation.url).hostname;
                    } catch {
                      return citation.url;
                    }
                  })()}
                </p>
              </div>
              <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
});

function CueCard({ cue }: { cue: AICue }) {
  switch (cue.type) {
    case "question":
      return <QuestionCard cue={cue} />;
    case "answer":
      return <AnswerCard cue={cue} />;
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
  // ─── Deep Answer (AI Cue Pro) ───
  answers?: AnswerCue[];
  isSearching?: boolean;
  searchError?: string | null;
  answerCount?: number;
  onTriggerDeepAnswer?: (question: string) => void;
}

export function AICuesPanel({
  cues,
  isLoading,
  error,
  callCount,
  isRecording,
  enabled,
  answers,
  isSearching,
  searchError,
  answerCount,
  onTriggerDeepAnswer,
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
        {(cues.length + (answers?.length || 0)) > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700 dark:bg-purple-900 dark:text-purple-300">
            {cues.length + (answers?.length || 0)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
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
          <span className="text-xs text-gray-400">{callCount}/20{answerCount ? ` · 🔍${answerCount}/10` : ""}</span>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            title={t("collapsePanel")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Manual Deep Answer Input */}
      {onTriggerDeepAnswer && (
        <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-700">
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder={t("askQuestion")}
              className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs
                         placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200
                         dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  onTriggerDeepAnswer(e.currentTarget.value.trim());
                  e.currentTarget.value = "";
                }
              }}
            />
            <button
              className="rounded-md bg-purple-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
              onClick={(e) => {
                const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                if (input?.value.trim()) {
                  onTriggerDeepAnswer(input.value.trim());
                  input.value = "";
                }
              }}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
          {isSearching && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-purple-600">
              <Spinner className="h-3 w-3" />
              {t("searching")}
            </div>
          )}
        </div>
      )}

      {/* Cue List */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
      >
        {error && (
          <div className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <X className="h-3 w-3" />
            {error}
          </div>
        )}

        {searchError && (
          <div className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <X className="h-3 w-3" />
            {searchError}
          </div>
        )}

        {cues.length === 0 && (!answers || answers.length === 0) && !isLoading && isRecording && (
          <div className="py-8 text-center text-xs text-gray-400">
            <Sparkles className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p>{t("waitingForCues")}</p>
            <p className="mt-1 text-gray-300 dark:text-gray-600">
              {t("waitingDescription")}
            </p>
          </div>
        )}

        {cues.length === 0 && (!answers || answers.length === 0) && !isRecording && (
          <div className="py-8 text-center text-xs text-gray-400">
            <p>{t("noRecording")}</p>
          </div>
        )}

        {(() => {
          const allCues: AICue[] = [
            ...cues,
            ...(answers || []),
          ].sort((a, b) => a.timestamp - b.timestamp);

          return allCues.map((cue) => (
            <CueCard key={cue.id} cue={cue} />
          ));
        })()}

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
