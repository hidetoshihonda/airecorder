"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
  RefreshCw,
  X,
  Users,
  CalendarCheck,
  Handshake,
  Code,
  Lightbulb,
  LogIn,
  MessageCircle,
  GitBranch,
  Tag,
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
import { AskAiPanel } from "@/components/AskAiPanel";
import { MindMapPanel } from "@/components/MindMapPanel";
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
import { useLocale } from "@/contexts/I18nContext";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { PRESET_TEMPLATES, getTemplateByIdSync, loadCustomTemplatesSync, customToMeetingTemplate } from "@/lib/meetingTemplates";
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

const LOCALE_MAP: Record<string, string> = { ja: "ja-JP", en: "en-US", es: "es-ES" };

function formatDate(dateString: string, locale = "ja"): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(LOCALE_MAP[locale] || locale, {
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
  const t = useTranslations("RecordingDetail");
  const tHome = useTranslations("HomePage");
  const { locale } = useLocale();

  const [recording, setRecording] = useState<Recording | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // Issue #135: タイムコード同期
  const [currentTime, setCurrentTime] = useState(0);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // LLM 補正版表示切り替え (Issue #70)
  const [transcriptView, setTranscriptView] = useState<"original" | "corrected">("corrected");
  
  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);

  // Tag editing state (Issue #80)
  const [newTag, setNewTag] = useState("");
  const [isUpdatingTags, setIsUpdatingTags] = useState(false);

  // Template selection state (Issue #38)
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("general");
  const [summaryLanguage, setSummaryLanguage] = useState("ja-JP");
  
  // Regenerate dialog state (Issue #64)
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [regenerateTemplateId, setRegenerateTemplateId] = useState<TemplateId>("general");
  const [regenerateLanguage, setRegenerateLanguage] = useState("ja-JP");

  // Template list and icons (Issue #38)
  const allTemplates = useMemo(() => {
    const customs = loadCustomTemplatesSync().map(customToMeetingTemplate);
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

  // Template name mapping for display (i18n)
  const TEMPLATE_NAMES: Record<string, string> = useMemo(() => ({
    summary: t("templateSummary"),
    meeting: t("templateMeeting"),
    oneOnOne: t("templateOneOnOne"),
    sales: t("templateSales"),
    devSprint: t("templateDevSprint"),
    brainstorm: t("templateBrainstorm"),
    general: t("templateGeneral"),
    regular: t("templateRegular"),
    "one-on-one": t("templateOneOnOne"),
    technical: t("templateTechReview"),
  }), [t]);

  const TEMPLATE_DESCRIPTIONS: Record<string, string> = useMemo(() => ({
    summaryDesc: t("templateSummaryDesc"),
    meetingDesc: t("templateMeetingDesc"),
    oneOnOneDesc: t("templateOneOnOneDesc"),
    salesDesc: t("templateSalesDesc"),
    devSprintDesc: t("templateDevSprintDesc"),
    brainstormDesc: t("templateBrainstormDesc"),
    general: t("templateGeneralDesc"),
    regular: t("templateRegularDesc"),
    "one-on-one": t("templateOneOnOneDesc"),
    sales: t("templateSalesDesc"),
    technical: t("templateTechReviewDesc"),
    brainstorm: t("templateBrainstormDesc"),
  }), [t]);

  useEffect(() => {
    // 認証チェック中または未認証の場合はデータ取得しない（Issue #57 セキュリティ修正）
    if (authLoading || !isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      if (!id) {
        setError(t("noRecordingId"));
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

  // LLM 補正中の場合、定期的に再取得 (Issue #70)
  useEffect(() => {
    if (!id || !recording) return;
    if (recording.correctionStatus !== "pending" && recording.correctionStatus !== "processing") {
      return;
    }

    const interval = setInterval(async () => {
      const response = await recordingsApi.getRecording(id);
      if (response.data) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRecording(response.data);
        if (
          response.data.correctionStatus === "completed" ||
          response.data.correctionStatus === "failed"
        ) {
          clearInterval(interval);
        }
      }
    }, 3000); // 3秒ごとにチェック

    return () => clearInterval(interval);
  }, [id, recording?.correctionStatus]);

  // 表示する文字起こしを決定 (Issue #70)
  const displayTranscript = useMemo(() => {
    if (transcriptView === "corrected" && recording?.correctedTranscript) {
      return recording.correctedTranscript;
    }
    return recording?.transcript;
  }, [recording, transcriptView]);

  // Issue #147: transcript segments から話者一覧を導出
  const speakerList = useMemo(() => {
    const segments = displayTranscript?.segments || [];
    const speakerMap = new Map<string, { id: string; count: number }>();

    for (const seg of segments) {
      if (seg.speaker) {
        const existing = speakerMap.get(seg.speaker);
        if (existing) {
          existing.count++;
        } else {
          speakerMap.set(seg.speaker, { id: seg.speaker, count: 1 });
        }
      }
    }

    return Array.from(speakerMap.values());
  }, [displayTranscript]);

  // Issue #135: displayTranscript 切替時に segmentRefs をクリア
  useEffect(() => {
    segmentRefs.current.clear();
  }, [displayTranscript]);

  // Issue #135: アクティブセグメントへの自動スクロール
  useEffect(() => {
    if (!isAutoScroll || !displayTranscript?.segments) return;

    const activeSegment = displayTranscript.segments.find(
      (seg) => currentTime >= seg.startTime && currentTime < seg.endTime
    );

    if (activeSegment) {
      const el = segmentRefs.current.get(activeSegment.id);
      if (el && transcriptContainerRef.current) {
        const container = transcriptContainerRef.current;
        const elTop = el.offsetTop - container.offsetTop;
        const elBottom = elTop + el.offsetHeight;
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;

        if (elTop < scrollTop || elBottom > scrollTop + containerHeight) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }
  }, [currentTime, displayTranscript, isAutoScroll]);

  // 補正リトライ (Issue #103)
  const [isRetryingCorrection, setIsRetryingCorrection] = useState(false);

  const handleRetryCorrection = async () => {
    if (!id || isRetryingCorrection) return;
    setIsRetryingCorrection(true);
    try {
      const response = await recordingsApi.retryCorrection(id);
      if (response.error) {
        console.error("[Correction] Retry failed:", response.error);
      } else {
        // ステータスをpendingに戻してポーリングを再開
        setRecording((prev) => prev ? { ...prev, correctionStatus: "pending", correctionError: undefined } : prev);
      }
    } catch (err) {
      console.error("[Correction] Retry error:", err);
    } finally {
      setIsRetryingCorrection(false);
    }
  };

  // 補正ステータスバッジ (Issue #70, #103)
  const correctionStatusBadge = useMemo(() => {
    switch (recording?.correctionStatus) {
      case "pending":
      case "processing":
        return <span className="text-xs text-blue-600 animate-pulse">{t("correctionPending")}</span>;
      case "completed":
        return <span className="text-xs text-green-600">{t("correctionCompleted")}</span>;
      case "failed":
        return (
          <span className="inline-flex items-center gap-1">
            <span className="text-xs text-red-600">{t("correctionFailed")}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetryCorrection}
              disabled={isRetryingCorrection}
              className="h-5 px-1.5 text-xs text-red-600 hover:text-red-700"
            >
              <RefreshCw className={cn("h-3 w-3", isRetryingCorrection && "animate-spin")} />
              {t("retryCorrection")}
            </Button>
          </span>
        );
      default:
        return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording?.correctionStatus, isRetryingCorrection, t]);

  const handleCopy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  // 議事録をMarkdown形式に変換してコピー
  const handleCopySummary = async () => {
    if (!recording?.summary) return;
    const summary = recording.summary;
    
    const lines: string[] = [];
    
    // 会議情報
    if (summary.meetingInfo) {
      lines.push(`# ${tHome("meetingInfo")}`);
      lines.push(`- **${t("meetingName")}** ${summary.meetingInfo.title}`);
      lines.push(`- **${t("dateTime")}** ${summary.meetingInfo.datetime}`);
      lines.push(`- **${t("participants")}** ${summary.meetingInfo.participants.join(", ") || tHome("undecided")}`);
      lines.push(`- **${t("purpose")}** ${summary.meetingInfo.purpose}`);
      lines.push("");
    }
    
    // アジェンダ
    if (summary.agenda && summary.agenda.length > 0) {
      lines.push(`## ${tHome("agendaList")}`);
      summary.agenda.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
      lines.push("");
    }
    
    // 主要な会話内容
    if (summary.topics && summary.topics.length > 0) {
      lines.push(`## ${tHome("topicDetails")}`);
      summary.topics.forEach((topic, i) => {
        lines.push(`### ${i + 1}. ${topic.title}`);
        if (topic.content) {
          lines.push(topic.content);
        } else {
          if (topic.background) lines.push(`- **${t("copyBackground")}** ${topic.background}`);
          if (topic.currentStatus) lines.push(`- **${t("copyCurrentStatus")}** ${topic.currentStatus}`);
          if (topic.issues) lines.push(`- **${t("copyIssues")}** ${topic.issues}`);
          if (topic.discussion) lines.push(`- **${t("copyDiscussion")}** ${topic.discussion}`);
          if (topic.nextActions) lines.push(`- **${t("copyNextActions")}** ${topic.nextActions}`);
        }
        lines.push("");
      });
    }
    
    // 決定事項
    if (summary.decisions && summary.decisions.length > 0) {
      lines.push(`## ${tHome("decisions")}`);
      summary.decisions.forEach(d => lines.push(`- ✓ ${d}`));
      lines.push("");
    }
    
    // アクションアイテム
    if (summary.actionItems && summary.actionItems.length > 0) {
      lines.push(`## ${tHome("todoActionItems")}`);
      lines.push(`| ${tHome("todoHeader")} | ${tHome("assigneeHeader")} | ${tHome("dueDateHeader")} |`);
      lines.push("|---|---|---|");
      summary.actionItems.forEach(item => {
        const task = item.task || item.description;
        const assignee = item.assignee || tHome("undecided");
        const due = item.dueDate || tHome("undecided");
        lines.push(`| ${task} | ${assignee} | ${due} |`);
      });
      lines.push("");
    }
    
    // 質疑応答
    if (summary.qaItems && summary.qaItems.length > 0) {
      lines.push(`## ${tHome("qaSection")}`);
      summary.qaItems.forEach(qa => {
        lines.push(`**Q:** ${qa.question}`);
        lines.push(`**A:** ${qa.answer}`);
        lines.push("");
      });
    }
    
    // 重要メモ
    if (summary.importantNotes && summary.importantNotes.length > 0) {
      lines.push(`## ${tHome("importantNotes")}`);
      summary.importantNotes.forEach(n => lines.push(`- 📌 ${n}`));
      lines.push("");
    }
    
    // 次回に向けて
    if (summary.nextSteps && summary.nextSteps.length > 0) {
      lines.push(`## ${tHome("nextSteps")}`);
      summary.nextSteps.forEach(s => lines.push(`- 📋 ${s}`));
      lines.push("");
    }
    
    // 旧形式のoverview/keyPoints
    if (!summary.meetingInfo && summary.overview) {
      lines.push(`## ${tHome("overview")}`);
      lines.push(summary.overview);
      lines.push("");
    }
    if (!summary.agenda && summary.keyPoints && summary.keyPoints.length > 0) {
      lines.push(`## ${tHome("keyPoints")}`);
      summary.keyPoints.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
      lines.push("");
    }
    
    await handleCopy(lines.join("\n"), "summary");
  };

  // 話者ラベル付きテキストを生成（Issue #120: correctedTranscript にも対応）
  const getTranscriptWithSpeakerLabels = (useCorrected?: boolean) => {
    const target = useCorrected ? recording?.correctedTranscript : recording?.transcript;
    if (!target?.segments || target.segments.length === 0) {
      return target?.fullText || "";
    }
    
    // segments に speaker 情報があるか確認
    const hasSpeakerInfo = target.segments.some(seg => seg.speaker);
    if (!hasSpeakerInfo) {
      return target.fullText;
    }

    return target.segments
      .map((seg) => {
        const label = (seg.speaker && recording?.speakerLabels?.[seg.speaker]) || seg.speaker || t("unknownSpeaker");
        return `[${label}] ${seg.text}`;
      })
      .join("\n");
  };

  const handleDelete = async () => {
    if (!id || !confirm(t("deleteConfirm"))) {
      return;
    }

    setIsDeleting(true);
    const response = await recordingsApi.deleteRecording(id);

    if (response.error) {
      alert(t("deleteFailed", { error: response.error }));
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
      alert(t("titleUpdateFailed", { error: response.error }));
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

  // タグ追加 (Issue #80)
  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const tagValue = newTag.trim().toLowerCase();
    if (!tagValue || !recording || !id) return;

    const currentTags = recording.tags || [];
    if (currentTags.includes(tagValue)) {
      setNewTag("");
      return;
    }
    if (currentTags.length >= 10) return;

    const updatedTags = [...currentTags, tagValue];
    setIsUpdatingTags(true);

    const response = await recordingsApi.updateRecording(id, {
      tags: updatedTags,
    });

    if (response.data) {
      setRecording(response.data);
    }
    setNewTag("");
    setIsUpdatingTags(false);
  };

  // タグ削除 (Issue #80)
  const handleRemoveTag = async (tagToRemove: string) => {
    if (!recording || !id) return;

    const updatedTags = (recording.tags || []).filter((t) => t !== tagToRemove);
    setIsUpdatingTags(true);

    const response = await recordingsApi.updateRecording(id, {
      tags: updatedTags,
    });

    if (response.data) {
      setRecording(response.data);
    }
    setIsUpdatingTags(false);
  };

  // Issue #147: 話者ラベル編集ハンドラ
  const handleRenameSpeaker = async (speakerId: string, currentLabel: string) => {
    const newName = prompt(t("enterSpeakerName"), currentLabel);
    if (!newName || !newName.trim() || newName.trim() === currentLabel) return;
    if (!recording || !id) return;

    const updatedLabels = {
      ...recording.speakerLabels,
      [speakerId]: newName.trim(),
    };

    const response = await recordingsApi.updateRecording(id, {
      speakerLabels: updatedLabels,
    });

    if (response.data) {
      setRecording(response.data);
    }
  };

  const handleGenerateSummary = async (overrideTemplateId?: TemplateId, overrideLanguage?: string) => {
    if (!id || !recording?.transcript?.fullText) return;

    const templateToUse = overrideTemplateId || selectedTemplateId;
    const languageToUse = overrideLanguage || summaryLanguage;

    setIsGeneratingSummary(true);

    // 話者ラベル付きトランスクリプトを使用（話者情報がある場合）
    const transcriptForSummary = getTranscriptWithSpeakerLabels();
    const response = await summaryApi.generateSummary({
      transcript: transcriptForSummary,
      language: languageToUse,
      templateId: templateToUse,
      ...(templateToUse.startsWith("custom-")
        ? { customPrompt: getTemplateByIdSync(templateToUse)?.systemPrompt }
        : {}),
    });

    setIsGeneratingSummary(false);

    if (response.error) {
      alert(t("summaryGenerateFailed", { error: response.error }));
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
        <span className="ml-2 text-gray-600">{t("loading")}</span>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p>{error || t("notFound")}</p>
        </div>
        <Link href="/history">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToHistory")}
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
            {t("backToHistory")}
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <FileDown className="mr-2 h-4 w-4" />
                {t("export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadAsText(recording, locale)}>
                <FileText className="mr-2 h-4 w-4" />
                {t("exportText")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadAsMarkdown(recording, locale)}>
                <FileText className="mr-2 h-4 w-4" />
                {t("exportMarkdown")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadAsJson(recording)}>
                <FileText className="mr-2 h-4 w-4" />
                {t("exportJson")}
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
            {formatDate(recording.createdAt, locale)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {formatDuration(recording.duration)}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
            {langName || recording.sourceLanguage}
          </span>
        </div>
        {/* Tags (Issue #80) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag className="h-4 w-4 text-gray-400 flex-shrink-0" />
          {recording.tags?.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-0.5 rounded-full text-blue-500 hover:text-blue-800 focus:outline-none"
                disabled={isUpdatingTags}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <form onSubmit={handleAddTag} className="inline-flex items-center">
            <Input
              type="text"
              placeholder={t("addTagPlaceholder")}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="h-6 w-32 text-xs px-2"
              maxLength={30}
              disabled={isUpdatingTags}
            />
          </form>
          {isUpdatingTags && <Spinner size="sm" />}
        </div>
      </div>

      {/* Unified Audio Player (BUG-2 fix: SAS 付き URL を使用) */}
      {recording.audioUrl && (
        <Card className="mb-6">
          <CardContent className="py-4">
            {isLoadingAudio ? (
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="text-sm text-gray-600">{t("loadingAudio")}</span>
              </div>
            ) : audioUrl ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-4">
                  <audio
                    ref={audioRef}
                    controls
                    className="flex-1"
                    src={audioUrl}
                    onTimeUpdate={() => {
                      if (audioRef.current) {
                        setCurrentTime(audioRef.current.currentTime);
                      }
                    }}
                    onSeeked={() => {
                      if (audioRef.current) {
                        setCurrentTime(audioRef.current.currentTime);
                      }
                    }}
                    onPlay={() => {
                      if (audioRef.current) {
                        audioRef.current.playbackRate = playbackRate;
                      }
                    }}
                  >
                    {t("audioNotSupported")}
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
                        alert(t("downloadFailed"));
                      }
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {t("download")}
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">
                    {t("playbackSpeed")}
                  </span>
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={cn(
                        "h-6 px-2 text-xs rounded-md transition-colors",
                        playbackRate === rate
                          ? "bg-gray-900 text-white shadow-sm font-medium"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      )}
                      onClick={() => {
                        setPlaybackRate(rate);
                        if (audioRef.current) {
                          audioRef.current.playbackRate = rate;
                          if ('preservesPitch' in audioRef.current) {
                            audioRef.current.preservesPitch = true;
                          } else if ('webkitPreservesPitch' in audioRef.current) {
                            (audioRef.current as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch = true;
                          }
                        }
                      }}
                    >
                      {rate === 1.0 ? "1x" : `${rate}x`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-yellow-700">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{t("audioLoadFailed")}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="transcript" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="transcript" className="gap-2">
            <FileText className="h-4 w-4" />
            {t("transcriptTab")}
          </TabsTrigger>
          <TabsTrigger value="translation" className="gap-2">
            <Languages className="h-4 w-4" />
            {t("translationTab")}
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-2">
            <Sparkles className="h-4 w-4" />
            {t("minutesTab")}
          </TabsTrigger>
          <TabsTrigger value="askAi" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            {t("askAiTab")}
          </TabsTrigger>
          <TabsTrigger value="mindmap" className="gap-2">
            <GitBranch className="h-4 w-4" />
            {t("mindmapTab")}
          </TabsTrigger>
        </TabsList>

        {/* Transcript Tab */}
        <TabsContent value="transcript">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 sm:gap-4">
                <CardTitle className="text-lg">{t("transcript")}</CardTitle>
                {correctionStatusBadge}
              </div>
              <div className="flex items-center gap-2">
                {/* オリジナル / AI補正版 切り替え (Issue #70) */}
                {recording.correctedTranscript && (
                  <div className="flex w-full rounded-lg border p-1 sm:w-auto">
                    <Button
                      variant={transcriptView === "original" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setTranscriptView("original")}
                      className="flex-1 text-xs sm:flex-none"
                    >
                      {t("original")}
                    </Button>
                    <Button
                      variant={transcriptView === "corrected" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setTranscriptView("corrected")}
                      className="flex-1 gap-1 text-xs sm:flex-none"
                    >
                      <Sparkles className="h-3 w-3" />
                      {t("aiCorrected")}
                    </Button>
                  </div>
                )}
                {/* Issue #135: 自動追従トグル */}
                {audioUrl && displayTranscript?.segments && displayTranscript.segments.length > 0 && (
                  <Button
                    variant={isAutoScroll ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setIsAutoScroll(!isAutoScroll)}
                    className="gap-1 text-xs"
                  >
                    {isAutoScroll ? t("autoScrollOn") : t("autoScrollOff")}
                  </Button>
                )}
                {displayTranscript?.fullText && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        getTranscriptWithSpeakerLabels(
                          transcriptView === "corrected" && !!recording.correctedTranscript
                        ),
                        "transcript"
                      )
                    }
                    className="gap-2"
                  >
                    {copied === "transcript" ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {t("copy")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Issue #147: 話者一覧パネル */}
              {speakerList.length > 0 && (
                <div className="mb-2 flex-none rounded-md border border-gray-200 p-2">
                  <h4 className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {t("speakerList")}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {speakerList.map((speaker) => {
                      const label = recording?.speakerLabels?.[speaker.id] || speaker.id;
                      return (
                        <div
                          key={speaker.id}
                          className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs bg-white"
                        >
                          <span className="font-bold text-gray-700">{label}</span>
                          <span className="text-gray-400">
                            ({t("speakerCount", { count: speaker.count })})
                          </span>
                          <button
                            onClick={() => handleRenameSpeaker(speaker.id, label)}
                            className="ml-1 text-gray-400 hover:text-gray-600 transition-colors"
                            title={t("renameSpeaker")}
                          >
                            ✏️
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {displayTranscript?.fullText ? (
                <div
                  ref={transcriptContainerRef}
                  className="max-h-[60vh] overflow-y-auto rounded-md bg-gray-50 p-2 sm:p-4"
                >
                  {displayTranscript.segments && displayTranscript.segments.length > 0 ? (
                    <div className="space-y-0.5">
                      {displayTranscript.segments.map((segment) => {
                        const isActive =
                          !!audioUrl &&
                          currentTime >= segment.startTime &&
                          currentTime < segment.endTime;
                        return (
                          <div
                            key={segment.id}
                            ref={(el) => {
                              if (el) segmentRefs.current.set(segment.id, el);
                              else segmentRefs.current.delete(segment.id);
                            }}
                            className={cn(
                              "group flex gap-2 sm:gap-3 rounded-md px-2 py-1.5 transition-colors",
                              isActive
                                ? "bg-blue-100 border-l-2 border-blue-500"
                                : "hover:bg-gray-100 border-l-2 border-transparent"
                            )}
                          >
                            <button
                              type="button"
                              className={cn(
                                "shrink-0 text-xs font-mono mt-0.5 tabular-nums",
                                audioUrl
                                  ? "text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                  : "text-gray-400 cursor-default"
                              )}
                              onClick={() => {
                                if (audioRef.current && audioUrl) {
                                  audioRef.current.currentTime = segment.startTime;
                                  audioRef.current.play();
                                  setIsAutoScroll(true);
                                }
                              }}
                              disabled={!audioUrl}
                              title={audioUrl ? t("seekToTimestamp") : ""}
                            >
                              {formatDuration(Math.floor(segment.startTime))}
                            </button>
                            {segment.speaker && (
                              <button
                                type="button"
                                onClick={() => handleRenameSpeaker(
                                  segment.speaker!,
                                  recording?.speakerLabels?.[segment.speaker!] || segment.speaker!
                                )}
                                className="shrink-0 text-xs font-medium text-purple-600 mt-0.5 hover:text-purple-800 hover:underline cursor-pointer bg-transparent border-none p-0"
                                title={t("renameSpeaker")}
                              >
                                {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
                              </button>
                            )}
                            <span className={cn(
                              "text-sm leading-relaxed",
                              transcriptView === "corrected" && recording?.correctedTranscript
                                ? "text-gray-900"
                                : "text-gray-800"
                            )}>
                              {segment.text}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-gray-800 p-2">
                      {displayTranscript.fullText}
                    </div>
                  )}
                </div>
              ) : recording.correctionStatus === "pending" || recording.correctionStatus === "processing" ? (
                <div className="py-8 text-center text-gray-500">
                  <Spinner className="mx-auto mb-2" />
                  <p>{t("correctionProcessing")}</p>
                  <p className="text-xs mt-2">{t("originalTranscript")}</p>
                  {recording.transcript?.fullText && (
                    <div className="mt-4 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800 text-left">
                      {recording.transcript.fullText}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  {t("noTranscript")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Translation Tab */}
        <TabsContent value="translation">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("translation")}</CardTitle>
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
                              {t("copy")}
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
                  {t("noTranslation")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Summary Tab */}
        <TabsContent value="summary">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">{tHome("minutesTitle")}</CardTitle>
              <div className="flex items-center gap-2">
                {recording.summary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopySummary}
                    className="gap-2"
                  >
                    {copied === "summary" ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied === "summary" ? tHome("summaryCopied") : tHome("copySummary")}
                  </Button>
                )}
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
                    {isGeneratingSummary ? tHome("generating") : tHome("generateWithAI")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isGeneratingSummary ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Spinner size="lg" />
                  <p className="mt-4 text-gray-600">
                    {tHome("aiGenerating")}
                  </p>
                </div>
              ) : recording.summary ? (
                <div className="max-h-[60vh] overflow-y-auto space-y-6">
                  {/* 注意書き */}
                  {recording.summary.caution && (
                    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
                      <p className="font-medium">{t("cautionNotes")}</p>
                      <p className="text-sm mt-1">{recording.summary.caution}</p>
                    </div>
                  )}

                  {/* 1. 会議情報 */}
                  {recording.summary.meetingInfo && (
                    <div className="rounded-md bg-gray-50 p-4">
                      <h3 className="text-sm font-medium text-gray-700 mb-3">{tHome("meetingInfo")}</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-gray-500">{t("meetingName")}</span> <span className="text-gray-800">{recording.summary.meetingInfo.title}</span></div>
                        <div><span className="text-gray-500">{t("dateTime")}</span> <span className="text-gray-800">{recording.summary.meetingInfo.datetime}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">{t("participants")}</span> <span className="text-gray-800">{recording.summary.meetingInfo.participants.join(", ") || t("unknown")}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">{t("purpose")}</span> <span className="text-gray-800">{recording.summary.meetingInfo.purpose}</span></div>
                      </div>
                    </div>
                  )}

                  {/* 2. アジェンダ一覧 */}
                  {recording.summary.agenda && recording.summary.agenda.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("agendaList")}</h3>
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

                  {/* 3. 主要な会話内容 */}
                  {recording.summary.topics && recording.summary.topics.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-3">{tHome("topicDetails")}</h3>
                      <div className="space-y-4">
                        {recording.summary.topics.map((topic, index) => (
                          <div key={index} className="rounded-md border border-gray-200 p-4">
                            <h4 className="font-medium text-gray-800 mb-3">{index + 1}. {topic.title}</h4>
                            {topic.content ? (
                              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{topic.content}</div>
                            ) : (
                              <div className="space-y-2 text-sm">
                                {topic.background && (
                                  <div><span className="text-gray-500 font-medium">{t("background")}</span> <span className="text-gray-700">{topic.background}</span></div>
                                )}
                                {topic.currentStatus && (
                                  <div><span className="text-gray-500 font-medium">{t("currentStatus")}</span> <span className="text-gray-700">{topic.currentStatus}</span></div>
                                )}
                                {topic.issues && (
                                  <div><span className="text-gray-500 font-medium">{t("issues")}</span> <span className="text-gray-700">{topic.issues}</span></div>
                                )}
                                {topic.discussion && (
                                  <div><span className="text-gray-500 font-medium">{t("discussionPoints")}</span> <span className="text-gray-700">{topic.discussion}</span></div>
                                )}
                                {topic.examples && (
                                  <div><span className="text-gray-500 font-medium">{t("examples")}</span> <span className="text-gray-700">{topic.examples}</span></div>
                                )}
                                {topic.nextActions && (
                                  <div><span className="text-gray-500 font-medium">{t("nextActions")}</span> <span className="text-gray-700">{topic.nextActions}</span></div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 4. 決定事項 */}
                  {recording.summary.decisions && recording.summary.decisions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("decisions")}</h3>
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
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("todoActionItems")}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700">{tHome("todoHeader")}</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700 w-24">{tHome("assigneeHeader")}</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700 w-28">{tHome("dueDateHeader")}</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700">{tHome("contextHeader")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recording.summary.actionItems.map((item) => (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="border border-gray-200 px-3 py-2 text-gray-800">{item.task || item.description}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.assignee || tHome("undecided")}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.dueDate || tHome("undecided")}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.context || tHome("noData")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* 6. 質疑応答 (Q&A) */}
                  {recording.summary.qaItems && recording.summary.qaItems.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("qaSection")}</h3>
                      <div className="space-y-3">
                        {recording.summary.qaItems.map((qa, index) => (
                          <div key={index} className="rounded-md border border-gray-200 p-3 text-sm">
                            <div className="flex items-start gap-2 mb-1">
                              <span className="text-blue-600 font-bold shrink-0">Q:</span>
                              <span className="text-gray-800">{qa.question}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-green-600 font-bold shrink-0">A:</span>
                              <span className="text-gray-700">{qa.answer}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 重要メモ */}
                  {recording.summary.importantNotes && recording.summary.importantNotes.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("importantNotes")}</h3>
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

                  {/* 7. 次回に向けて */}
                  {recording.summary.nextSteps && recording.summary.nextSteps.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("nextSteps")}</h3>
                      <ul className="space-y-2">
                        {recording.summary.nextSteps.map((step, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-teal-50 p-3 text-gray-800 text-sm">
                            <span className="text-teal-600">📋</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 後方互換: 旧形式の overview/keyPoints があれば表示 */}
                  {!recording.summary.meetingInfo && recording.summary.overview && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("overview")}</h3>
                      <div className="rounded-md bg-gray-50 p-4 text-gray-800">
                        {recording.summary.overview}
                      </div>
                    </div>
                  )}
                  {!recording.summary.agenda && recording.summary.keyPoints && recording.summary.keyPoints.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{tHome("keyPoints")}</h3>
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
                      {t("regenerate")}
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
                            {t("outputLanguage")}
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
                            {t("template")}
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
                      <p>{t("emptyMinutesWithTranscript")}</p>
                    </>
                  ) : (
                    <p>{t("emptyMinutesNoTranscript")}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ask AI Tab (Issue #85) */}
        <TabsContent value="askAi">
          <Card>
            <CardContent className="p-0">
              <AskAiPanel
                recordingId={recording.id}
                hasTranscript={!!(recording.transcript?.fullText || recording.correctedTranscript?.fullText)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mind Map Tab (Issue #88) */}
        <TabsContent value="mindmap">
          <Card>
            <CardContent className="pt-6">
              <MindMapPanel
                recording={recording}
                transcript={getTranscriptWithSpeakerLabels()}
                onRecordingUpdate={(updated) => setRecording(updated)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 再生成ダイアログ (Issue #64) */}
      <Dialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("regenerateTitle")}</DialogTitle>
            <DialogDescription>{t("regenerateDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* 出力言語選択 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t("outputLanguage")}
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
                {t("selectTemplate")}
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
              {t("cancel")}
            </Button>
            <Button onClick={handleRegenerate} disabled={isGeneratingSummary}>
              {isGeneratingSummary ? <Spinner size="sm" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {t("regenerateButton")}
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
          <span className="ml-2 text-gray-600">Loading...</span>
        </div>
      }
    >
      <RecordingDetailContent />
    </Suspense>
  );
}
