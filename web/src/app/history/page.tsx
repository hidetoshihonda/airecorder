"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  Play,
  Trash2,
  Download,
  Calendar,
  Clock,
  RefreshCw,
  AlertCircle,
  LogIn,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { useLocale as useAppLocale } from "@/contexts/I18nContext";
import { useAuth } from "@/contexts/AuthContext";
import { Recording } from "@/types";
import { recordingsApi, blobApi } from "@/services";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateString: string, locale: string): string {
  const date = new Date(dateString);
  const dateLocale = locale === "ja" ? "ja-JP" : locale === "es" ? "es-ES" : "en-US";
  return date.toLocaleDateString(dateLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const t = useTranslations("HistoryPage");
  const { locale: appLocale } = useAppLocale();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  // BUG-1 fix: SAS 付き URL を取得してから再生・DL する
  const handlePlay = async (recording: Recording) => {
    if (!recording.audioUrl) return;
    setLoadingAudioId(recording.id);
    try {
      const playableUrl = await blobApi.getPlayableUrl(recording.audioUrl);
      if (playableUrl) {
        window.open(playableUrl, '_blank');
      } else {
        alert(t("audioLoadFailed"));
      }
    } catch {
      alert(t("audioFetchError"));
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleDownload = async (recording: Recording) => {
    if (!recording.audioUrl) return;
    setLoadingAudioId(recording.id);
    try {
      const playableUrl = await blobApi.getPlayableUrl(recording.audioUrl);
      if (playableUrl) {
        // fetch → blob → createObjectURL で cross-origin DL 対応
        const response = await fetch(playableUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = blob.type.includes('mp4') ? '.m4a' : blob.type.includes('wav') ? '.wav' : '.webm';
        a.download = `${recording.title}${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert(t("downloadFailed"));
      }
    } catch {
      alert(t("downloadError"));
    } finally {
      setLoadingAudioId(null);
    }
  };

  useEffect(() => {
    // 認証チェック中または未認証の場合はデータ取得しない（Issue #57 セキュリティ修正）
    if (authLoading || !isAuthenticated) {
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      const response = await recordingsApi.listRecordings(
        1,
        50,
        searchQuery || undefined
      );

      if (response.error) {
        setError(response.error);
        setRecordings([]);
      } else if (response.data) {
        // APIレスポンス: { items: [...], total, page, ... } or { data: [...] }
        const responseData = response.data as unknown;
        const items = Array.isArray(responseData)
          ? responseData as Recording[]
          : (responseData as Record<string, unknown>).items as Recording[] || [];
        console.log('[History] Loaded recordings:', items.length);
        setRecordings(items);
      }

      setIsLoading(false);
    };
    fetchData();
  }, [searchQuery, isAuthenticated, authLoading]);

  const fetchRecordings = useCallback(async () => {
    // 未認証の場合は取得しない（Issue #57 セキュリティ修正）
    if (!isAuthenticated) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const response = await recordingsApi.listRecordings(
      1,
      50,
      searchQuery || undefined
    );

    if (response.error) {
      setError(response.error);
      setRecordings([]);
    } else if (response.data) {
      // APIレスポンス: { items: [...], total, page, ... } or { data: [...] }
      const responseData = response.data as unknown;
      const items = Array.isArray(responseData)
        ? responseData as Recording[]
        : (responseData as Record<string, unknown>).items as Recording[] || [];
      console.log('[History] Refreshed recordings:', items.length);
      setRecordings(items);
    }

    setIsLoading(false);
  }, [searchQuery, isAuthenticated]);

  const handleDelete = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) {
      return;
    }

    setIsDeleting(id);
    const response = await recordingsApi.deleteRecording(id);

    if (response.error) {
      alert(t("deleteFailed", { error: response.error || "Unknown" }));
    } else {
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    }

    setIsDeleting(null);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRecordings();
  };

  // 認証ローディング中
  if (authLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // 未認証時のログイン誘導UI
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-6">
          <div className="rounded-full bg-blue-100 p-6 dark:bg-blue-900/30">
            <LogIn className="h-12 w-12 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t("loginRequired")}
            </h2>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t("loginRequiredDescription")}
            </p>
          </div>
          <Button
            onClick={login}
            size="lg"
            className="mt-4"
          >
            <LogIn className="mr-2 h-5 w-5" />
            {t("loginButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
          <p className="mt-1 text-gray-600">
            {t("description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchRecordings}
          disabled={isLoading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </Button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            placeholder={t("searchPlaceholder")}
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t("fetchFailed")}</p>
            <p className="text-sm">
              {error === "Network error"
                ? t("networkError")
                : error}
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
          <span className="ml-2 text-gray-600">{t("loading")}</span>
        </div>
      )}

      {/* Recordings List */}
      {!isLoading && (
        <div className="space-y-4">
          {recordings.length > 0 ? (
            recordings.map((recording) => (
              <Card
                key={recording.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link
                        href={`/recording?id=${recording.id}`}
                        className="text-lg font-medium text-gray-900 hover:text-blue-600"
                      >
                        {recording.title}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {formatDate(recording.createdAt, appLocale)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {formatDuration(recording.duration)}
                        </span>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                          {recording.sourceLanguage}
                        </span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        {recording.transcript && (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                            {t("transcribed")}
                          </span>
                        )}
                        {recording.translations &&
                          Object.keys(recording.translations).length > 0 && (
                            <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                              {t("translated")}
                            </span>
                          )}
                        {recording.summary && (
                          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                            {t("minutesCreated")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {recording.audioUrl ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-600"
                            onClick={() => handlePlay(recording)}
                            disabled={loadingAudioId === recording.id}
                          >
                            {loadingAudioId === recording.id ? (
                              <Spinner size="sm" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-600"
                            onClick={() => handleDownload(recording)}
                            disabled={loadingAudioId === recording.id}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {t("noAudio")}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => handleDelete(recording.id)}
                        disabled={isDeleting === recording.id}
                      >
                        {isDeleting === recording.id ? (
                          <Spinner size="sm" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-gray-500">
                  {error
                    ? t("fetchFailedShort")
                    : searchQuery
                      ? t("noSearchResults")
                      : t("noRecordings")}
                </p>
                <Link href="/" className="mt-4 inline-block">
                  <Button>{t("startRecording")}</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
