"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Copy,
  Check,
  Trash2,
  Calendar,
  Clock,
  Languages,
  FileText,
  Sparkles,
  AlertCircle,
  FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Recording } from "@/types";
import { recordingsApi, summaryApi, blobApi } from "@/services";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import {
  downloadAsText,
  downloadAsMarkdown,
  downloadAsJson,
} from "@/lib/export";

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

function RecordingDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("id");

  const [recording, setRecording] = useState<Recording | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) {
        setError("録音IDが指定されていません");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const response = await recordingsApi.getRecording(id);

      if (response.error) {
        setError(response.error);
      } else if (response.data) {
        setRecording(response.data);
        
        // Load audio URL if available
        if (response.data.audioUrl) {
          setIsLoadingAudio(true);
          const playableUrl = await blobApi.getPlayableUrl(response.data.audioUrl);
          if (playableUrl) {
            setAudioUrl(playableUrl);
          }
          setIsLoadingAudio(false);
        }
      }

      setIsLoading(false);
    };
    fetchData();
  }, [id]);

  const handleCopy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDelete = async () => {
    if (!id || !confirm("この録音を削除しますか？この操作は取り消せません。")) {
      return;
    }

    setIsDeleting(true);
    const response = await recordingsApi.deleteRecording(id);

    if (response.error) {
      alert(`削除に失敗しました: ${response.error}`);
      setIsDeleting(false);
    } else {
      router.push("/history");
    }
  };

  const handleGenerateSummary = async () => {
    if (!id || !recording?.transcript?.fullText) return;

    setIsGeneratingSummary(true);

    const response = await summaryApi.generateSummary({
      transcript: recording.transcript.fullText,
      language: recording.sourceLanguage,
    });

    setIsGeneratingSummary(false);

    if (response.error) {
      alert(`議事録生成に失敗しました: ${response.error}`);
    } else if (response.data) {
      const updateResponse = await recordingsApi.updateRecording(id, {
        summary: response.data,
      });

      if (updateResponse.data) {
        setRecording(updateResponse.data);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
        <span className="ml-2 text-gray-600">読み込み中...</span>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p>{error || "録音が見つかりません"}</p>
        </div>
        <Link href="/history">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            履歴に戻る
          </Button>
        </Link>
      </div>
    );
  }

  const langName = SUPPORTED_LANGUAGES.find(
    (l) => l.code === recording.sourceLanguage
  )?.name;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <Link href="/history">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            履歴に戻る
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <FileDown className="mr-2 h-4 w-4" />
                エクスポート
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadAsText(recording)}>
                <FileText className="mr-2 h-4 w-4" />
                テキスト (.txt)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadAsMarkdown(recording)}>
                <FileText className="mr-2 h-4 w-4" />
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadAsJson(recording)}>
                <FileText className="mr-2 h-4 w-4" />
                JSON (.json)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Title & Meta */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{recording.title}</h1>
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
            {langName || recording.sourceLanguage}
          </span>
        </div>
      </div>

      {/* Unified Audio Player (BUG-2 fix: SAS 付き URL を使用) */}
      {recording.audioUrl && (
        <Card className="mb-6">
          <CardContent className="py-4">
            {isLoadingAudio ? (
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="text-sm text-gray-600">音声を読み込み中...</span>
              </div>
            ) : audioUrl ? (
              <div className="flex items-center gap-4">
                <audio controls className="flex-1" src={audioUrl}>
                  お使いのブラウザは音声再生をサポートしていません。
                </audio>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const response = await fetch(audioUrl);
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
                    } catch {
                      alert('ダウンロードに失敗しました');
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  ダウンロード
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-yellow-700">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">音声ファイルを読み込めませんでした</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="transcript" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="transcript" className="gap-2">
            <FileText className="h-4 w-4" />
            文字起こし
          </TabsTrigger>
          <TabsTrigger value="translation" className="gap-2">
            <Languages className="h-4 w-4" />
            翻訳
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-2">
            <Sparkles className="h-4 w-4" />
            議事録
          </TabsTrigger>
        </TabsList>

        {/* Transcript Tab */}
        <TabsContent value="transcript">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">文字起こし</CardTitle>
              {recording.transcript?.fullText && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleCopy(recording.transcript!.fullText, "transcript")
                  }
                  className="gap-2"
                >
                  {copied === "transcript" ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  コピー
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {recording.transcript?.fullText ? (
                <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                  {recording.transcript.fullText}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  文字起こしデータがありません
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Translation Tab */}
        <TabsContent value="translation">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">翻訳</CardTitle>
            </CardHeader>
            <CardContent>
              {recording.translations &&
              Object.keys(recording.translations).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(recording.translations).map(
                    ([langCode, translation]) => {
                      const lang = SUPPORTED_LANGUAGES.find(
                        (l) => l.code === langCode || l.translatorCode === langCode
                      );
                      return (
                        <div key={langCode}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-500">
                              {lang?.flag} {lang?.name || langCode}
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleCopy(translation.fullText, langCode)
                              }
                              className="gap-2"
                            >
                              {copied === langCode ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                              コピー
                            </Button>
                          </div>
                          <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
                            {translation.fullText}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  翻訳データがありません
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Summary Tab */}
        <TabsContent value="summary">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">議事録</CardTitle>
              {recording.transcript?.fullText && !recording.summary && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateSummary}
                  disabled={isGeneratingSummary}
                  className="gap-2"
                >
                  {isGeneratingSummary ? (
                    <Spinner size="sm" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {isGeneratingSummary ? "生成中..." : "AIで生成"}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {isGeneratingSummary ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Spinner size="lg" />
                  <p className="mt-4 text-gray-600">
                    AIが議事録を生成しています...
                  </p>
                </div>
              ) : recording.summary ? (
                <div className="space-y-6">
                  {/* 注意書き */}
                  {recording.summary.caution && (
                    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
                      <p className="font-medium">⚠️ 注意事項</p>
                      <p className="text-sm mt-1">{recording.summary.caution}</p>
                    </div>
                  )}

                  {/* 1. 会議情報 */}
                  {recording.summary.meetingInfo && (
                    <div className="rounded-md bg-gray-50 p-4">
                      <h3 className="text-sm font-medium text-gray-700 mb-3">1. 会議情報</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-gray-500">会議名:</span> <span className="text-gray-800">{recording.summary.meetingInfo.title}</span></div>
                        <div><span className="text-gray-500">日時:</span> <span className="text-gray-800">{recording.summary.meetingInfo.datetime}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">参加者:</span> <span className="text-gray-800">{recording.summary.meetingInfo.participants.join(", ") || "不明"}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">目的:</span> <span className="text-gray-800">{recording.summary.meetingInfo.purpose}</span></div>
                      </div>
                    </div>
                  )}

                  {/* 2. アジェンダ一覧 */}
                  {recording.summary.agenda && recording.summary.agenda.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">2. アジェンダ一覧</h3>
                      <ul className="space-y-1">
                        {recording.summary.agenda.map((item, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm text-gray-800">
                            <span className="text-blue-600 font-medium">{index + 1}.</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 3. 議題別の詳細 */}
                  {recording.summary.topics && recording.summary.topics.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-3">3. 議題別の詳細</h3>
                      <div className="space-y-4">
                        {recording.summary.topics.map((topic, index) => (
                          <div key={index} className="rounded-md border border-gray-200 p-4">
                            <h4 className="font-medium text-gray-800 mb-3">3.{index + 1}. {topic.title}</h4>
                            <div className="space-y-2 text-sm">
                              {topic.background && (
                                <div><span className="text-gray-500 font-medium">背景・前提:</span> <span className="text-gray-700">{topic.background}</span></div>
                              )}
                              {topic.currentStatus && (
                                <div><span className="text-gray-500 font-medium">現状共有:</span> <span className="text-gray-700">{topic.currentStatus}</span></div>
                              )}
                              {topic.issues && (
                                <div><span className="text-gray-500 font-medium">課題/懸念:</span> <span className="text-gray-700">{topic.issues}</span></div>
                              )}
                              {topic.discussion && (
                                <div><span className="text-gray-500 font-medium">議論の要点:</span> <span className="text-gray-700">{topic.discussion}</span></div>
                              )}
                              {topic.examples && (
                                <div><span className="text-gray-500 font-medium">具体例:</span> <span className="text-gray-700">{topic.examples}</span></div>
                              )}
                              {topic.nextActions && (
                                <div><span className="text-gray-500 font-medium">次アクション:</span> <span className="text-gray-700">{topic.nextActions}</span></div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 4. 決定事項 */}
                  {recording.summary.decisions && recording.summary.decisions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">4. 決定事項</h3>
                      <ul className="space-y-2">
                        {recording.summary.decisions.map((decision, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-green-50 p-3 text-gray-800 text-sm">
                            <span className="text-green-600">✓</span>
                            <span>{decision}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 5. ToDo / アクションアイテム */}
                  {recording.summary.actionItems && recording.summary.actionItems.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">5. ToDo / アクションアイテム</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700">ToDo</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700 w-24">担当</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700 w-28">期限</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700">関連背景</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recording.summary.actionItems.map((item) => (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="border border-gray-200 px-3 py-2 text-gray-800">{item.task || item.description}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.assignee || "未定"}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.dueDate || "未定"}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.context || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* 6. 重要メモ */}
                  {recording.summary.importantNotes && recording.summary.importantNotes.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">6. 重要メモ</h3>
                      <ul className="space-y-2">
                        {recording.summary.importantNotes.map((note, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-purple-50 p-3 text-gray-800 text-sm">
                            <span className="text-purple-600">📌</span>
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 後方互換: 旧形式の overview/keyPoints があれば表示 */}
                  {!recording.summary.meetingInfo && recording.summary.overview && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">概要</h3>
                      <div className="rounded-md bg-gray-50 p-4 text-gray-800">
                        {recording.summary.overview}
                      </div>
                    </div>
                  )}
                  {!recording.summary.agenda && recording.summary.keyPoints && recording.summary.keyPoints.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">重要ポイント</h3>
                      <ul className="space-y-2">
                        {recording.summary.keyPoints.map((point, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-gray-800">
                            <span className="text-blue-600 font-medium">{index + 1}.</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-center pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateSummary}
                      disabled={isGeneratingSummary}
                      className="gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      再生成
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  {recording.transcript?.fullText ? (
                    <>
                      <Sparkles className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                      <p>「AIで生成」ボタンをクリックして議事録を作成できます</p>
                    </>
                  ) : (
                    <p>文字起こしデータがないため議事録を生成できません</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function RecordingDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Spinner size="lg" />
          <span className="ml-2 text-gray-600">読み込み中...</span>
        </div>
      }
    >
      <RecordingDetailContent />
    </Suspense>
  );
}
