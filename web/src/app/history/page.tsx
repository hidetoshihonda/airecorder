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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Recording } from "@/types";
import { recordingsApi } from "@/services";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("ja-JP", {
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

  useEffect(() => {
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
  }, [searchQuery]);

  const fetchRecordings = useCallback(async () => {
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
  }, [searchQuery]);

  const handleDelete = async (id: string) => {
    if (!confirm("この録音を削除しますか？")) {
      return;
    }

    setIsDeleting(id);
    const response = await recordingsApi.deleteRecording(id);

    if (response.error) {
      alert(`削除に失敗しました: ${response.error}`);
    } else {
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    }

    setIsDeleting(null);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRecordings();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">録音履歴</h1>
          <p className="mt-1 text-gray-600">
            過去の録音を確認・再生・ダウンロード
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
          更新
        </Button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            placeholder="録音を検索..."
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
            <p className="font-medium">データの取得に失敗しました</p>
            <p className="text-sm">
              {error === "Network error"
                ? "APIサーバーに接続できません。Azure Functionsがデプロイされていることを確認してください。"
                : error}
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
          <span className="ml-2 text-gray-600">読み込み中...</span>
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
                          {formatDate(recording.createdAt)}
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
                            文字起こし済み
                          </span>
                        )}
                        {recording.translations &&
                          Object.keys(recording.translations).length > 0 && (
                            <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                              翻訳済み
                            </span>
                          )}
                        {recording.summary && (
                          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                            議事録作成済み
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {recording.audioUrl && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-600"
                            asChild
                          >
                            <a
                              href={recording.audioUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Play className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-600"
                            asChild
                          >
                            <a href={recording.audioUrl} download>
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        </>
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
                    ? "データを取得できませんでした"
                    : searchQuery
                      ? "検索結果がありません"
                      : "録音履歴がありません"}
                </p>
                <Link href="/" className="mt-4 inline-block">
                  <Button>録音を開始</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
