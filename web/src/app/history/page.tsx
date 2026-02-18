"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  FolderOpen,
  Plus,
  MoreVertical,
  Tag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { useLocale as useAppLocale } from "@/contexts/I18nContext";
import { useAuth } from "@/contexts/AuthContext";
import { Recording, Folder } from "@/types";
import { recordingsApi, blobApi, foldersApi } from "@/services";

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
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [movingRecordingId, setMovingRecordingId] = useState<string | null>(null);
  // Issue #80: タグフィルタ
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // Issue #81: debounce 用 state
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const t = useTranslations("HistoryPage");
  const { locale: appLocale } = useAppLocale();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  // Issue #81: searchQuery → debouncedSearch に 400ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
        debouncedSearch || undefined,
        selectedFolderId || undefined,
        selectedTag || undefined
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
        setRecordings(items);
      }

      setIsLoading(false);
    };
    fetchData();
  }, [debouncedSearch, selectedFolderId, selectedTag, isAuthenticated, authLoading]);

  // フォルダ一覧を取得 (Issue #83)
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchFolders = async () => {
      const response = await foldersApi.list();
      if (response.data) {
        setFolders(response.data);
      }
    };
    fetchFolders();
  }, [isAuthenticated]);

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
      debouncedSearch || undefined,
      selectedFolderId || undefined,
      selectedTag || undefined
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
      setRecordings(items);
    }

    setIsLoading(false);
  }, [debouncedSearch, selectedFolderId, selectedTag, isAuthenticated]);

  // Issue #80: 全録音から使用中のタグ一覧を集計
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    recordings.forEach((r) => {
      r.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [recordings]);

  // フォルダ作成 (Issue #83)
  const handleCreateFolder = async () => {
    const name = prompt(t("folderNamePrompt"));
    if (!name?.trim()) return;

    const response = await foldersApi.create({ name: name.trim() });
    if (response.data) {
      setFolders((prev) => [...prev, response.data!]);
    }
  };

  // フォルダ削除 (Issue #83)
  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm(t("deleteFolderConfirm"))) return;

    const response = await foldersApi.delete(folderId);
    if (!response.error) {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      fetchRecordings();
    }
  };

  // フォルダ名変更 (Issue #83)
  const handleRenameFolder = async (folder: Folder) => {
    const newName = prompt(t("folderNamePrompt"), folder.name);
    if (!newName?.trim() || newName.trim() === folder.name) return;

    const response = await foldersApi.update(folder.id, {
      name: newName.trim(),
    });
    if (response.data) {
      setFolders((prev) =>
        prev.map((f) => (f.id === folder.id ? response.data! : f))
      );
    }
  };

  // 録音をフォルダに移動 (Issue #83)
  const handleMoveToFolder = async (
    recordingId: string,
    folderId: string | null
  ) => {
    setMovingRecordingId(recordingId);
    const response = await recordingsApi.updateRecording(recordingId, {
      folderId: folderId,
    });
    if (!response.error) {
      if (selectedFolderId) {
        // フォルダフィルタ中は移動した録音を一覧から除去
        setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
      } else {
        // 「すべて」表示の場合はローカル更新
        setRecordings((prev) =>
          prev.map((r) =>
            r.id === recordingId
              ? { ...r, folderId: folderId || undefined }
              : r
          )
        );
      }
    }
    setMovingRecordingId(null);
  };

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

      {/* Folder Tabs */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedFolderId(null)}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            selectedFolderId === null
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {t("allFolders")}
        </button>
        {folders.map((folder) => (
          <div key={folder.id} className="group relative flex items-center">
            <button
              onClick={() => setSelectedFolderId(folder.id)}
              className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                selectedFolderId === folder.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {folder.name}
            </button>
            <div className="ml-1 hidden gap-0.5 group-hover:flex">
              <button
                onClick={() => handleRenameFolder(folder)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                title={t("renameFolder")}
              >
                <MoreVertical className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleDeleteFolder(folder.id)}
                className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
                title={t("deleteFolder")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={handleCreateFolder}
          className="flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("newFolder")}
        </button>
      </div>

      {/* Tag Filter (Issue #80) */}
      {allTags.length > 0 && (
        <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
          <Tag className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <button
            onClick={() => setSelectedTag(null)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedTag === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t("allTags")}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                selectedTag === tag
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

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
                      <div className="mt-2 flex flex-wrap gap-2">
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
                        {/* Tags (Issue #80) */}
                        {recording.tags && recording.tags.length > 0 &&
                          recording.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                            >
                              {tag}
                            </span>
                          ))
                        }
                      </div>
                      {/* Folder move */}
                      <div className="mt-2 flex items-center gap-2">
                        <FolderOpen className="h-3.5 w-3.5 text-gray-400" />
                        <select
                          className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 focus:border-blue-500 focus:outline-none"
                          value={recording.folderId || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleMoveToFolder(recording.id, val || null);
                          }}
                        >
                          <option value="">{t("allFolders")}</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </div>
                      {/* Issue #81: 全文検索スニペット */}
                      {debouncedSearch && (() => {
                        const ft = recording.transcript?.fullText || "";
                        const cft = recording.correctedTranscript?.fullText || "";
                        const q = debouncedSearch.toLowerCase();
                        const matchText = ft.toLowerCase().includes(q) ? ft : cft.toLowerCase().includes(q) ? cft : null;
                        if (!matchText) return null;
                        const idx = matchText.toLowerCase().indexOf(q);
                        const start = Math.max(0, idx - 40);
                        const end = Math.min(matchText.length, idx + debouncedSearch.length + 40);
                        const prefix = start > 0 ? "..." : "";
                        const suffix = end < matchText.length ? "..." : "";
                        const before = matchText.slice(start, idx);
                        const match = matchText.slice(idx, idx + debouncedSearch.length);
                        const after = matchText.slice(idx + debouncedSearch.length, end);
                        return (
                          <div className="mt-2 text-xs text-gray-600 bg-yellow-50 rounded-md p-2 border border-yellow-100">
                            <span className="text-yellow-700 font-medium mr-1">📝</span>
                            {prefix}{before}<mark className="bg-yellow-200 rounded px-0.5">{match}</mark>{after}{suffix}
                          </div>
                        );
                      })()}
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
