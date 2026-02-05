import type { Metadata } from "next";
import Link from "next/link";
import { Search, Play, Trash2, Download, Calendar, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "録音履歴",
  description: "過去の録音を確認・再生・ダウンロード",
};

// Placeholder data - will be replaced with actual data from API
const mockRecordings = [
  {
    id: "1",
    title: "会議録音 - プロジェクトA",
    createdAt: "2024-01-15T10:30:00Z",
    duration: 1800,
    language: "ja-JP",
    hasTranscript: true,
    hasTranslation: true,
  },
  {
    id: "2",
    title: "インタビュー - 田中様",
    createdAt: "2024-01-14T14:00:00Z",
    duration: 2400,
    language: "ja-JP",
    hasTranscript: true,
    hasTranslation: false,
  },
  {
    id: "3",
    title: "英語ミーティング",
    createdAt: "2024-01-13T09:00:00Z",
    duration: 3600,
    language: "en-US",
    hasTranscript: true,
    hasTranslation: true,
  },
];

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
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">録音履歴</h1>
        <p className="mt-1 text-gray-600">過去の録音を確認・再生・ダウンロード</p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            placeholder="録音を検索..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Recordings List */}
      <div className="space-y-4">
        {mockRecordings.length > 0 ? (
          mockRecordings.map((recording) => (
            <Card key={recording.id} className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Link
                      href={`/recording/${recording.id}`}
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
                        {recording.language}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      {recording.hasTranscript && (
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                          文字起こし済み
                        </span>
                      )}
                      {recording.hasTranslation && (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          翻訳済み
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="text-gray-600">
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-gray-600">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">録音履歴がありません</p>
              <Link href="/" className="mt-4 inline-block">
                <Button>録音を開始</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
