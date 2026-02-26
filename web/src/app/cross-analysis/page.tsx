"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  RefreshCw,
  FileDown,
  Calendar,
  Clock,
  AlertCircle,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { CrossAnalysisResultView } from "@/components/CrossAnalysisResult";
import { crossAnalysisApi } from "@/services";
import { useAuth } from "@/contexts/AuthContext";
import { CrossAnalysisResult } from "@/types";

function formatDurationShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}分`;
}

export default function CrossAnalysisPage() {
  const [result, setResult] = useState<CrossAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingIds, setRecordingIds] = useState<string[]>([]);
  const t = useTranslations("CrossAnalysisPage");
  const { isAuthenticated, isLoading: authLoading, login, user } = useAuth();

  // sessionStorage から選択された録音IDを取得
  useEffect(() => {
    const stored = sessionStorage.getItem("crossAnalysisRecordingIds");
    if (stored) {
      try {
        const ids = JSON.parse(stored) as string[];
        setRecordingIds(ids);
      } catch {
        setError(t("error"));
      }
    }
  }, [t]);

  // userId を API service に設定
  useEffect(() => {
    crossAnalysisApi.setUserId(user?.id || null);
  }, [user]);

  // 分析実行
  const runAnalysis = useCallback(async () => {
    if (recordingIds.length < 2) return;

    setIsAnalyzing(true);
    setError(null);

    const response = await crossAnalysisApi.analyze({
      recordingIds,
      analysisType: "full",
    });

    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setResult(response.data);
    }

    setIsAnalyzing(false);
  }, [recordingIds]);

  // 初回自動実行
  useEffect(() => {
    if (recordingIds.length >= 2 && isAuthenticated && !result && !isAnalyzing) {
      runAnalysis();
    }
  }, [recordingIds, isAuthenticated, result, isAnalyzing, runAnalysis]);

  // エクスポート（Markdown）
  const handleExport = useCallback(() => {
    if (!result) return;

    const lines: string[] = [];
    lines.push(`# ${t("title")}`);
    lines.push(`\n> ${t("generatedAt", { date: new Date(result.generatedAt).toLocaleString() })}`);

    lines.push(`\n## ${t("analyzedRecordings")}`);
    for (const rec of result.analyzedRecordings) {
      lines.push(`- ${rec.title} (${rec.date}, ${formatDurationShort(rec.duration)})`);
    }

    lines.push(`\n## ${t("overallSummary")}`);
    lines.push(result.overallSummary);

    if (result.commonThemes.length > 0) {
      lines.push(`\n## ${t("commonThemes")}`);
      for (const theme of result.commonThemes) {
        lines.push(`\n### ${theme.theme} (${theme.frequency}回)`);
        lines.push(theme.description);
        lines.push(`言及: ${theme.mentionedIn.join(", ")}`);
      }
    }

    if (result.actionItemTracking.length > 0) {
      lines.push(`\n## ${t("actionTracking")}`);
      for (const item of result.actionItemTracking) {
        lines.push(`\n### ${item.task}`);
        lines.push(`- 担当: ${item.assignee}`);
        lines.push(`- ステータス: ${item.status}`);
        lines.push(`- 初回言及: ${item.firstMentioned}`);
        lines.push(`- 最新: ${item.lastMentioned}`);
        if (item.history.length > 0) {
          lines.push("- 履歴:");
          for (const h of item.history) {
            lines.push(`  - ${h.recordingTitle} (${h.date}): ${h.update}`);
          }
        }
      }
    }

    if (result.decisionEvolution.length > 0) {
      lines.push(`\n## ${t("decisionEvolution")}`);
      for (const de of result.decisionEvolution) {
        lines.push(`\n### ${de.topic}`);
        for (const d of de.decisions) {
          lines.push(`- ${d.recordingTitle} (${d.date}): ${d.decision}`);
        }
      }
    }

    if (result.trends.recurringIssues.length > 0) {
      lines.push(`\n## ${t("recurringIssues")}`);
      for (const issue of result.trends.recurringIssues) {
        lines.push(`- ${issue}`);
      }
    }

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cross-analysis-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, t]);

  // 認証ローディング中
  if (authLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // 未認証
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-6">
          <div className="rounded-full bg-blue-100 p-6 dark:bg-blue-900/30">
            <LogIn className="h-12 w-12 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900">
              {t("loginRequired")}
            </h2>
          </div>
          <Button onClick={login} size="lg">
            <LogIn className="mr-2 h-5 w-5" />
            {t("loginButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/history">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t("backToHistory")}
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <FileDown className="mr-1 h-4 w-4" />
              {t("export")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={runAnalysis}
            disabled={isAnalyzing || recordingIds.length < 2}
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`}
            />
            {t("reAnalyze")}
          </Button>
        </div>
      </div>

      {/* Analyzed Recordings Summary */}
      {result && result.analyzedRecordings.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-500">
              {t("analyzedRecordings")} ({result.analyzedRecordings.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {result.analyzedRecordings.map((rec) => (
                <Link
                  key={rec.id}
                  href={`/recording?id=${rec.id}`}
                  className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
                >
                  <Calendar className="h-3 w-3" />
                  {rec.title}
                  <span className="text-gray-400">
                    <Clock className="inline h-3 w-3" /> {rec.date}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t("analysisFailed")}</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isAnalyzing && (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600">{t("analyzing")}</p>
          <p className="mt-1 text-sm text-gray-400">
            {t("analyzingDescription")}
          </p>
        </div>
      )}

      {/* Results */}
      {!isAnalyzing && result && <CrossAnalysisResultView result={result} />}

      {/* No recording IDs */}
      {!isAnalyzing && !result && !error && recordingIds.length < 2 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">{t("noRecordingsSelected")}</p>
            <Link href="/history" className="mt-4 inline-block">
              <Button>{t("backToHistory")}</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Generated At */}
      {result && (
        <p className="mt-6 text-center text-xs text-gray-400">
          {t("generatedAt", {
            date: new Date(result.generatedAt).toLocaleString(),
          })}
        </p>
      )}
    </div>
  );
}
