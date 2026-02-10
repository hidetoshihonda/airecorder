"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
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
  PenSquare,
  X,
  Users,
  CalendarCheck,
  Handshake,
  Code,
  Lightbulb,
  LogIn,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Recording, TemplateId } from "@/types";
import { recordingsApi, summaryApi, blobApi } from "@/services";
import { useAuth } from "@/contexts/AuthContext";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { PRESET_TEMPLATES, getTemplateById, loadCustomTemplates, customToMeetingTemplate } from "@/lib/meetingTemplates";
import { cn } from "@/lib/utils";
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
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  const [recording, setRecording] = useState<Recording | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  
  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);

  // Template selection state (Issue #38)
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("summary");
  const [summaryLanguage, setSummaryLanguage] = useState("ja-JP");
  
  // Regenerate dialog state (Issue #64)
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [regenerateTemplateId, setRegenerateTemplateId] = useState<TemplateId>("summary");
  const [regenerateLanguage, setRegenerateLanguage] = useState("ja-JP");

  // Template list and icons (Issue #38)
  const allTemplates = useMemo(() => {
    const customs = loadCustomTemplates().map(customToMeetingTemplate);
    return [...PRESET_TEMPLATES, ...customs];
  }, []);

  const TEMPLATE_ICONS: Record<string, React.ReactNode> = useMemo(() => ({
    FileText: <FileText className="h-4 w-4" />,
    CalendarCheck: <CalendarCheck className="h-4 w-4" />,
    Users: <Users className="h-4 w-4" />,
    Handshake: <Handshake className="h-4 w-4" />,
    Code: <Code className="h-4 w-4" />,
    Lightbulb: <Lightbulb className="h-4 w-4" />,
    PenSquare: <PenSquare className="h-4 w-4" />,
  }), []);

  // Template name mapping for display (プリセットテンプレートの日本語表示)
  const TEMPLATE_NAMES: Record<string, string> = useMemo(() => ({
    summary: "要約",
    meeting: "会議",
    oneOnOne: "1on1",
    sales: "商談・営業",
    devSprint: "開発MTG",
    brainstorm: "ブレスト",
    // 後方互換性のため古いキーも残す
    general: "一般",
    regular: "定例会議",
    "one-on-one": "1on1",
    technical: "技術レビュー",
  }), []);

  const TEMPLATE_DESCRIPTIONS: Record<string, string> = useMemo(() => ({
    summaryDesc: "シンプルな要約",
    meetingDesc: "詳細な議事録",
    oneOnOneDesc: "1on1ミーティング向け",
    salesDesc: "商談・営業会議向け",
    devSprintDesc: "スプリントレビュー向け",
    brainstormDesc: "アイデア出し・ブレスト向け",
    // 後方互換性のため古いキーも残す
    general: "汎用的な議事録",
    regular: "進捗確認・定例",
    "one-on-one": "個人面談・1on1",
    sales: "商談・提案",
    technical: "技術検討・レビュー",
    brainstorm: "アイデア出し",
  }), []);

  useEffect(() => {
    // 認証チェック中または未認証の場合はデータ取得しない（Issue #57 セキュリティ修正）
    if (authLoading || !isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      return;
    }

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
        // Sync summaryLanguage with recording's source language (Issue #38)
        setSummaryLanguage(response.data.sourceLanguage);
        
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
  }, [id, isAuthenticated, authLoading]);

  const handleCopy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  // 話者ラベル付きテキストを生成
  const getTranscriptWithSpeakerLabels = () => {
    if (!recording?.transcript?.segments || recording.transcript.segments.length === 0) {
      return recording?.transcript?.fullText || "";
    }
    
    // segments に speaker 情報があるか確認
    const hasSpeakerInfo = recording.transcript.segments.some(seg => seg.speaker);
    if (!hasSpeakerInfo) {
      return recording.transcript.fullText;
    }

    return recording.transcript.segments
      .map((seg) => {
        const label = seg.speaker || "不明";
        return `[${label}] ${seg.text}`;
      })
      .join("\n");
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

  // Title editing handlers
  const handleTitleEdit = () => {
    if (recording) {
      setEditedTitle(recording.title);
      setIsEditingTitle(true);
    }
  };

  const handleTitleSave = async () => {
    if (!id || !recording) return;
    
    const trimmed = editedTitle.trim();
    if (!trimmed || trimmed === recording.title) {
      setIsEditingTitle(false);
      return;
    }
    
    setIsUpdatingTitle(true);
    const response = await recordingsApi.updateRecording(id, { title: trimmed });
    setIsUpdatingTitle(false);
    
    if (response.error) {
      alert(`タイトル更新に失敗しました: ${response.error}`);
      return;
    }
    
    if (response.data) {
      setRecording(response.data);
    }
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setIsEditingTitle(false);
    setEditedTitle("");
  };

  const handleGenerateSummary = async (overrideTemplateId?: TemplateId, overrideLanguage?: string) => {
    if (!id || !recording?.transcript?.fullText) return;

    const templateToUse = overrideTemplateId || selectedTemplateId;
    const languageToUse = overrideLanguage || summaryLanguage;

    setIsGeneratingSummary(true);

    // Issue #38: templateId, customPrompt, languageを送信
    const response = await summaryApi.generateSummary({
      transcript: recording.transcript.fullText,
      language: languageToUse,
      templateId: templateToUse,
      ...(templateToUse.startsWith("custom-")
        ? { customPrompt: getTemplateById(templateToUse)?.systemPrompt }
        : {}),
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

  // Issue #64: 再生成ダイアログを開く
  const handleOpenRegenerateDialog = () => {
    setRegenerateTemplateId(selectedTemplateId);
    setRegenerateLanguage(summaryLanguage);
    setIsRegenerateDialogOpen(true);
  };

  // Issue #64: 再生成を実行
  const handleRegenerate = async () => {
    setIsRegenerateDialogOpen(false);
    setSelectedTemplateId(regenerateTemplateId);
    setSummaryLanguage(regenerateLanguage);
    await handleGenerateSummary(regenerateTemplateId, regenerateLanguage);
  };

  // 認証ローディング中
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // 未認証時のログイン誘導UI（Issue #57 セキュリティ修正）
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-6">
          <div className="rounded-full bg-blue-100 p-6 dark:bg-blue-900/30">
            <LogIn className="h-12 w-12 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              ログインが必要です
            </h2>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              録音の詳細を表示するにはログインしてください。
            </p>
          </div>
          <Button
            onClick={login}
            size="lg"
            className="mt-4"
          >
            <LogIn className="mr-2 h-5 w-5" />
            ログイン
          </Button>
        </div>
      </div>
    );
  }

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
        {isEditingTitle ? (
          <div className="flex items-center gap-2">
            <Input
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="text-xl font-bold max-w-md"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTitleSave();
                if (e.key === "Escape") handleTitleCancel();
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTitleSave}
              disabled={isUpdatingTitle}
              className="text-green-600 hover:bg-green-50"
            >
              {isUpdatingTitle ? <Spinner size="sm" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTitleCancel}
              className="text-gray-500 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{recording.title}</h1>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTitleEdit}
              className="text-gray-400 hover:text-gray-600"
            >
              <PenSquare className="h-4 w-4" />
            </Button>
          </div>
        )}
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
                    handleCopy(getTranscriptWithSpeakerLabels(), "transcript")
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
                <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
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
                <div className="max-h-[60vh] overflow-y-auto space-y-4">
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
                  onClick={() => handleGenerateSummary()}
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
                <div className="max-h-[60vh] overflow-y-auto space-y-6">
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
                      onClick={handleOpenRegenerateDialog}
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
                      {/* Issue #38: テンプレート選択UI */}
                      <div className="mb-6 space-y-4 text-left">
                        {/* 出力言語 */}
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                            出力言語
                          </label>
                          <Select value={summaryLanguage} onValueChange={setSummaryLanguage}>
                            <SelectTrigger className="h-8 w-44 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SUPPORTED_LANGUAGES.map((lang) => (
                                <SelectItem key={lang.code} value={lang.code}>
                                  {lang.flag} {lang.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* テンプレート選択グリッド */}
                        <div>
                          <label className="text-sm font-medium text-gray-700 mb-2 block">
                            テンプレート
                          </label>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {allTemplates.map((tmpl) => (
                              <button
                                key={tmpl.id}
                                onClick={() => setSelectedTemplateId(tmpl.id)}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                                  selectedTemplateId === tmpl.id
                                    ? "border-blue-500 bg-blue-50 text-blue-800"
                                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                                )}
                              >
                                {TEMPLATE_ICONS[tmpl.icon] || <FileText className="h-4 w-4" />}
                                <div className="min-w-0">
                                  <div className="font-medium truncate text-xs">
                                    {tmpl.isPreset ? (TEMPLATE_NAMES[tmpl.id] || tmpl.nameKey) : tmpl.nameKey}
                                  </div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {tmpl.isPreset ? (TEMPLATE_DESCRIPTIONS[tmpl.id] || tmpl.descriptionKey) : tmpl.descriptionKey}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

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

      {/* 再生成ダイアログ (Issue #64) */}
      <Dialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>議事録を再生成</DialogTitle>
            <DialogDescription>テンプレートと出力言語を選択してください</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* 出力言語選択 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                出力言語
              </label>
              <Select value={regenerateLanguage} onValueChange={setRegenerateLanguage}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* テンプレート選択 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                テンプレートを選択
              </label>
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {allTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => setRegenerateTemplateId(tmpl.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                      regenerateTemplateId === tmpl.id
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    )}
                  >
                    {TEMPLATE_ICONS[tmpl.icon] || <FileText className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {tmpl.isPreset ? (TEMPLATE_NAMES[tmpl.nameKey] || tmpl.nameKey) : tmpl.nameKey}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {tmpl.isPreset ? (TEMPLATE_DESCRIPTIONS[tmpl.descriptionKey] || tmpl.descriptionKey) : tmpl.descriptionKey}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRegenerateDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleRegenerate} disabled={isGeneratingSummary}>
              {isGeneratingSummary ? <Spinner size="sm" /> : <Sparkles className="h-4 w-4 mr-1" />}
              再生成する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
