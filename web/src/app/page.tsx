"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Mic, Square, Languages, FileText, Copy, Check, AlertCircle, Save, Sparkles, Pause, Play, Volume2, VolumeX, ArrowDown, ChevronDown, Users, Lightbulb, CalendarCheck, Code, Handshake, PenSquare, Zap, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocale as useAppLocale } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SUPPORTED_LANGUAGES, speechConfig, translatorConfig } from "@/lib/config";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useTranslation } from "@/hooks/useTranslation";
import { useTranslationRecognizer } from "@/hooks/useTranslationRecognizer";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useRecordingStateMachine } from "@/hooks/useRecordingStateMachine";
import { useSpeakerManager } from "@/hooks/useSpeakerManager";
import { useAICues } from "@/hooks/useAICues";
import { AuthGateModal } from "@/components/ui/AuthGateModal";
import { TranscriptView } from "@/components/TranscriptView";
import { AICuesPanel } from "@/components/AICuesPanel";
import { recordingsApi, summaryApi, blobApi } from "@/services";
import { Summary, TemplateId } from "@/types";
import { PRESET_TEMPLATES, getTemplateByIdSync, loadCustomTemplatesSync, customToMeetingTemplate } from "@/lib/meetingTemplates";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

/**
 * テキストを文区切りで分割し、最新の N 文のみ返す。
 * Issue #33: displayTranslation に対して適用される。
 */
function getRecentSentences(text: string, count: number = 5): string {
  if (!text) return "";
  // 日本語句点(。)、英語ピリオド(.)、!?で区切り
  const sentences = text.split(/(?<=[。.!?！？])\s*/g).filter(Boolean);
  if (sentences.length <= count) return text;
  return "…" + sentences.slice(-count).join(" ");
}

export default function HomePage() {
  const { settings } = useAuth();
  const t = useTranslations("HomePage");
  const { locale: appLocale } = useAppLocale();
  const { requireAuth, isModalOpen, closeModal, blockedAction } = useAuthGate();
  
  const [sourceLanguage, setSourceLanguage] = useState(settings.defaultSourceLanguage);
  const [targetLanguage, setTargetLanguage] = useState(settings.defaultTargetLanguages[0] || "en-US");
  
  // Sync language settings when settings change (e.g., after navigation from settings page)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSourceLanguage(settings.defaultSourceLanguage);
    setTargetLanguage(settings.defaultTargetLanguages[0] || "en-US");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [settings.defaultSourceLanguage, settings.defaultTargetLanguages]);
  const [translatedText, setTranslatedText] = useState("");
  const [copied, setCopied] = useState<"transcript" | "translation" | "summary" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("general");
  const [summaryLanguage, setSummaryLanguage] = useState(settings.defaultTargetLanguages[0] || "en-US");
  const [isRealtimeTranslation, setIsRealtimeTranslation] = useState(true);
  
  // Save dialog state
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [recordingTitle, setRecordingTitle] = useState("");
  
  // Regenerate dialog state
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [regenerateTemplateId, setRegenerateTemplateId] = useState<TemplateId>("summary");
  const [regenerateLanguage, setRegenerateLanguage] = useState(settings.defaultTargetLanguages[0] || "en-US");
  
  // Issue #33: Track translated segment count for differential translation
  const prevSegmentCountRef = useRef(0);
  const interimTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Translation scroll control
  const translationScrollRef = useRef<HTMLDivElement>(null);
  const [translationAutoFollow, setTranslationAutoFollow] = useState(true);

  // Issue #105: Translation display mode (recent N sentences vs full text)
  const [translationDisplayMode, setTranslationDisplayMode] = useState<"recent" | "full">("recent");

  // Recording State Machine (BUG-1~7 の根本修正)
  const {
    recordingState,
    fsmError,
    dispatch,
    isIdle,
    isRecording: fsmIsRecording,
    isPaused: fsmIsPaused,
    isStopped,
    isTransitioning,
    canStart,
    canPause,
    canResume,
    canStop,
  } = useRecordingStateMachine();

  // Issue #35: Translation mode — SDK mode (low latency) vs API mode (speaker diarization)
  const enableSpeakerDiarization = settings.enableSpeakerDiarization ?? false;
  const translationMode = enableSpeakerDiarization ? "api" : "sdk";

  // Speech Recognition (API mode: SpeechRecognizer + ConversationTranscriber)
  const {
    isListening: _apiIsListening,
    isPaused: _apiIsPaused,
    transcript: apiTranscript,
    segments: apiSegments,
    interimTranscript: apiInterimTranscript,
    error: apiSpeechError,
    startListening: apiStartListening,
    stopListening: apiStopListening,
    pauseListening: apiPauseListening,
    resumeListening: apiResumeListening,
    resetTranscript: apiResetTranscript,
  } = useSpeechRecognition({
    subscriptionKey: speechConfig.subscriptionKey,
    region: speechConfig.region,
    language: sourceLanguage,
    enableSpeakerDiarization,
    phraseList: settings.phraseList ?? [],
  });

  // Issue #35: SDK mode (TranslationRecognizer — recognition + translation in single pipeline)
  const {
    isListening: _sdkIsListening,
    isPaused: _sdkIsPaused,
    transcript: sdkTranscript,
    segments: sdkSegments,
    translatedSegments: sdkTranslatedSegments,
    interimTranscript: sdkInterimTranscript,
    interimTranslation: sdkInterimTranslation,
    translatedFullText: sdkTranslatedFullText,
    error: sdkSpeechError,
    startListening: sdkStartListening,
    stopListening: sdkStopListening,
    pauseListening: sdkPauseListening,
    resumeListening: sdkResumeListening,
    resetTranscript: sdkResetTranscript,
  } = useTranslationRecognizer({
    subscriptionKey: speechConfig.subscriptionKey,
    region: speechConfig.region,
    sourceLanguage,
    targetLanguage,
    phraseList: settings.phraseList ?? [],
  });

  // Issue #35: Unified data sources — select active mode's data
  const transcript = translationMode === "sdk" ? sdkTranscript : apiTranscript;
  const segments = translationMode === "sdk" ? sdkSegments : apiSegments;
  const interimTranscript = translationMode === "sdk" ? sdkInterimTranscript : apiInterimTranscript;
  const speechError = translationMode === "sdk" ? sdkSpeechError : apiSpeechError;
  const startListening = translationMode === "sdk" ? sdkStartListening : apiStartListening;
  const stopListening = translationMode === "sdk" ? sdkStopListening : apiStopListening;
  const pauseListening = translationMode === "sdk" ? sdkPauseListening : apiPauseListening;
  const resumeListening = translationMode === "sdk" ? sdkResumeListening : apiResumeListening;

  // Audio Recording (for saving audio files)
  const {
    duration,
    audioBlob,
    error: audioError,
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    pauseRecording: pauseAudioRecording,
    resumeRecording: resumeAudioRecording,
    resetRecording: resetAudioRecording,
  } = useAudioRecorder({ audioQuality: settings.audioQuality });

  // Translation (Issue #33: segment-based differential translation — API mode only)
  const {
    isTranslating,
    error: translationError,
    translate,
    translatedSegments: apiTranslatedSegments,
    translatedFullText: apiTranslatedFullText,
    interimTranslation: apiInterimTranslation,
    translateSegment,
    translateInterim,
    resetSegments,
  } = useTranslation({
    subscriptionKey: translatorConfig.subscriptionKey,
    region: translatorConfig.region,
  });

  // Issue #35: Unified translated data
  const translatedSegments = translationMode === "sdk" ? sdkTranslatedSegments : apiTranslatedSegments;
  const translatedFullText = translationMode === "sdk" ? sdkTranslatedFullText : apiTranslatedFullText;
  const interimTranslation = translationMode === "sdk" ? sdkInterimTranslation : apiInterimTranslation;

  // Text-to-Speech
  const {
    isSpeaking,
    error: ttsError,
    speak,
    stop: stopSpeaking,
  } = useTextToSpeech({
    subscriptionKey: speechConfig.subscriptionKey,
    region: speechConfig.region,
  });

  // DESIGN-4 fix: エラーを配列で管理（全エラーを表示）
  const errors = [speechError, translationError, ttsError, audioError, fsmError].filter(Boolean) as string[];
  const hasApiKeys = speechConfig.subscriptionKey && translatorConfig.subscriptionKey;

  // Speaker Manager (Issue #9: 話者ラベル管理)
  const { speakers, renameSpeaker, getSpeakerLabel, updateFromSegments, resetSpeakers } = useSpeakerManager();

  // segments が変わったら speaker 情報を同期
  useEffect(() => {
    if (enableSpeakerDiarization && segments.length > 0) {
      updateFromSegments(segments);
    }
  }, [segments, enableSpeakerDiarization, updateFromSegments]);

  // segments に speakerLabel を付与して TranscriptView に渡す
  const labeledSegments = useMemo(() => {
    if (!enableSpeakerDiarization) return segments;
    return segments.map((seg) => ({
      ...seg,
      speakerLabel: seg.speaker ? getSpeakerLabel(seg.speaker) : undefined,
    }));
  }, [segments, enableSpeakerDiarization, getSpeakerLabel]);

  // FSM ベースの表示状態（isListening の代わりに使用）
  const showRecordingUI = fsmIsRecording || fsmIsPaused || isTransitioning;

  // Issue #89: AI Cues — リアルタイム文脈補助
  const enableAICues = settings.enableAICues ?? false;
  const {
    cues: aiCues,
    isLoading: isCuesLoading,
    error: cuesError,
    callCount: cuesCallCount,
    clearCues,
  } = useAICues({
    segments,
    sourceLanguage,
    enabled: enableAICues,
    isRecording: showRecordingUI,
  });

  // テンプレートアイコンマッピング
  const TEMPLATE_ICONS: Record<string, React.ReactNode> = useMemo(() => ({
    FileText: <FileText className="h-4 w-4" />,
    CalendarCheck: <CalendarCheck className="h-4 w-4" />,
    Users: <Users className="h-4 w-4" />,
    Handshake: <Handshake className="h-4 w-4" />,
    Code: <Code className="h-4 w-4" />,
    Lightbulb: <Lightbulb className="h-4 w-4" />,
    PenSquare: <PenSquare className="h-4 w-4" />,
  }), []);

  // プリセット + カスタムテンプレート一覧
  const allTemplates = useMemo(() => {
    const customs = loadCustomTemplatesSync().map(customToMeetingTemplate);
    return [...PRESET_TEMPLATES, ...customs];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回のみ（カスタムテンプレートは設定ページで管理）

  // BUG-7 fix: Duration は useAudioRecorder 内部で管理（isListening 依存を排除）
  // 録音中のページ離脱防止（beforeunload）
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (fsmIsRecording || fsmIsPaused) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [fsmIsRecording, fsmIsPaused]);

  // Issue #33: Segment-based differential translation — API mode only
  // (SDK mode handles translation internally via TranslationRecognizer)
  useEffect(() => {
    if (translationMode !== "api") return;
    if (!isRealtimeTranslation || !showRecordingUI) return;

    // Detect new segments since last check
    const newSegments = segments.slice(prevSegmentCountRef.current);
    prevSegmentCountRef.current = segments.length;

    for (const seg of newSegments) {
      translateSegment(seg, sourceLanguage, targetLanguage);
    }
  }, [segments, sourceLanguage, targetLanguage, isRealtimeTranslation, showRecordingUI, translateSegment, translationMode]);

  // Issue #33: Interim (in-progress) text translation with 300ms debounce — API mode only
  useEffect(() => {
    if (translationMode !== "api") return;
    if (!interimTranscript || !isRealtimeTranslation || !showRecordingUI) return;

    if (interimTimeoutRef.current) {
      clearTimeout(interimTimeoutRef.current);
    }

    interimTimeoutRef.current = setTimeout(() => {
      translateInterim(interimTranscript, sourceLanguage, targetLanguage);
    }, 300);

    return () => {
      if (interimTimeoutRef.current) {
        clearTimeout(interimTimeoutRef.current);
      }
    };
  }, [interimTranscript, sourceLanguage, targetLanguage, isRealtimeTranslation, showRecordingUI, translateInterim, translationMode]);

  // Issue #33: Fallback — when recording stops, if some segments are untranslated, translate full text
  useEffect(() => {
    if (!showRecordingUI && transcript && translatedSegments.length > 0 && translatedSegments.length < segments.length) {
      // Some segments failed — fallback to full text translation
      translate(transcript, sourceLanguage, targetLanguage).then((result) => {
        if (result) {
          setTranslatedText(result);
        }
      });
    }
    // Also handle: recording stopped with no real-time translation (RT off)
    if (!showRecordingUI && transcript && translatedSegments.length === 0 && !isRealtimeTranslation) {
      translate(transcript, sourceLanguage, targetLanguage).then((result) => {
        if (result) {
          setTranslatedText(result);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecordingUI]);

  // Issue #33: Combined display translation (segments + interim)
  const displayTranslation = useMemo(() => {
    const base = translatedFullText;
    const interim = interimTranslation;
    if (!base && !interim) return translatedText; // fallback for non-RT mode
    return interim
      ? (base ? base + " " + interim : interim)
      : base;
  }, [translatedFullText, interimTranslation, translatedText]);

  // Issue #33: Language change → reset segment cache and re-translate (API mode only)
  // SDK mode: TranslationRecognizer re-creates on targetLanguage change via hook deps
  const prevTargetLanguageRef = useRef(targetLanguage);
  useEffect(() => {
    if (prevTargetLanguageRef.current !== targetLanguage) {
      prevTargetLanguageRef.current = targetLanguage;
      if (translationMode === "api") {
        resetSegments();
        prevSegmentCountRef.current = 0;
        // Re-translate existing segments with new language
        if (showRecordingUI && isRealtimeTranslation) {
          for (const seg of segments) {
            translateSegment(seg, sourceLanguage, targetLanguage);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLanguage]);

  // Issue #4: Auto-scroll for translation tab with rAF
  useEffect(() => {
    if (translationAutoFollow && translationScrollRef.current) {
      requestAnimationFrame(() => {
        if (translationScrollRef.current) {
          translationScrollRef.current.scrollTop = translationScrollRef.current.scrollHeight;
        }
      });
    }
  }, [displayTranslation, translationAutoFollow]);

  // Issue #4: Detect manual scroll on translation container
  const handleTranslationScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (!isAtBottom && translationAutoFollow) {
      setTranslationAutoFollow(false);
    }
  }, [translationAutoFollow]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartRecording = async () => {
    // 認証ゲート: 未ログインならモーダル表示でブロック
    if (!requireAuth(t("startRecording"))) return;
    // FSM ガード: 遷移不可なら無視（連打防止）
    if (!canStart) return;

    dispatch({ type: "START" });
    setTranslatedText("");
    setSaveSuccess(false);
    setSummary(null);
    setSummaryError(null);
    // Issue #33/35: Reset segment-based translation state (both modes)
    resetSegments();
    apiResetTranscript();
    sdkResetTranscript();
    prevSegmentCountRef.current = 0;
    setTranslationAutoFollow(true);
    resetSpeakers();
    resetAudioRecording();
    clearCues();
    
    try {
      // Start both speech recognition and audio recording
      startListening();
      await startAudioRecording();
      dispatch({ type: "START_SUCCESS" });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("startRecordingFailed");
      dispatch({ type: "START_FAILURE", error: message });
    }
  };

  // BUG-4 fix: stopListening → stopAudioRecording を順序保証
  const handleStopRecording = () => {
    if (!canStop) return;
    dispatch({ type: "STOP" });
    stopListening();
    stopAudioRecording();
    dispatch({ type: "STOP_SUCCESS" });
  };

  const handlePauseRecording = () => {
    if (!canPause) return;
    dispatch({ type: "PAUSE" });
    pauseListening();
    pauseAudioRecording();
    dispatch({ type: "PAUSE_SUCCESS" });
  };

  const handleResumeRecording = () => {
    if (!canResume) return;
    dispatch({ type: "RESUME" });
    resumeListening();
    resumeAudioRecording();
    dispatch({ type: "RESUME_SUCCESS" });
  };

  const handleGenerateSummary = async (overrideTemplateId?: TemplateId, overrideLanguage?: string) => {
    if (!transcript) return;
    // 認証ゲート: 未ログインならモーダル表示でブロック
    if (!requireAuth(t("generateMinutes"))) return;

    const templateToUse = overrideTemplateId || selectedTemplateId;
    const languageToUse = overrideLanguage || summaryLanguage;

    setIsGeneratingSummary(true);
    setSummaryError(null);

    // 話者識別有効時は話者ラベル付きフォーマットで送信
    const transcriptForSummary = enableSpeakerDiarization && segments.some((s) => s.speaker)
      ? segments.map((s) => `[${s.speakerLabel || s.speaker || t("unknownSpeaker")}] ${s.text}`).join("\n")
      : transcript;

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
      setSummaryError(response.error);
    } else if (response.data) {
      setSummary(response.data);
    }
  };

  // 再生成ダイアログを開く
  const handleOpenRegenerateDialog = () => {
    setRegenerateTemplateId(selectedTemplateId);
    setRegenerateLanguage(summaryLanguage);
    setIsRegenerateDialogOpen(true);
  };

  // 再生成を実行
  const handleRegenerate = async () => {
    setIsRegenerateDialogOpen(false);
    // 選択したテンプレートと言語をメイン設定にも反映
    setSelectedTemplateId(regenerateTemplateId);
    setSummaryLanguage(regenerateLanguage);
    await handleGenerateSummary(regenerateTemplateId, regenerateLanguage);
  };

  // 話者ラベル付きテキストを生成
  const getTranscriptWithSpeakerLabels = useCallback(() => {
    if (!enableSpeakerDiarization || labeledSegments.length === 0) {
      return transcript;
    }
    return labeledSegments
      .map((seg) => {
        const label = seg.speakerLabel || seg.speaker || t("unknownSpeaker");
        return `[${label}] ${seg.text}`;
      })
      .join("\n");
  }, [enableSpeakerDiarization, labeledSegments, transcript, t]);

  const handleCopy = useCallback(async (text: string, type: "transcript" | "translation" | "summary") => {
    // 文字起こしの場合、話者ラベル付きテキストを使用
    const textToCopy = type === "transcript" ? getTranscriptWithSpeakerLabels() : text;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }, [getTranscriptWithSpeakerLabels]);

  // 議事録をMarkdown形式に変換してコピー
  const handleCopySummary = useCallback(async () => {
    if (!summary) return;
    
    const lines: string[] = [];
    
    // 会議情報
    if (summary.meetingInfo) {
      lines.push(`# ${t("meetingInfo")}`);
      lines.push(`- **${t("meetingName")}** ${summary.meetingInfo.title}`);
      lines.push(`- **${t("datetime")}** ${summary.meetingInfo.datetime}`);
      lines.push(`- **${t("participants")}** ${summary.meetingInfo.participants.join(", ") || t("undecided")}`);
      lines.push(`- **${t("purpose")}** ${summary.meetingInfo.purpose}`);
      lines.push("");
    }
    
    // アジェンダ
    if (summary.agenda && summary.agenda.length > 0) {
      lines.push(`## ${t("agendaList")}`);
      summary.agenda.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
      lines.push("");
    }
    
    // 議題別詳細
    if (summary.topics && summary.topics.length > 0) {
      lines.push(`## ${t("topicDetails")}`);
      summary.topics.forEach((topic, i) => {
        lines.push(`### ${i + 1}. ${topic.title}`);
        if (topic.background) lines.push(`- **${t("copyBackground")}** ${topic.background}`);
        if (topic.currentStatus) lines.push(`- **${t("copyCurrentStatus")}** ${topic.currentStatus}`);
        if (topic.issues) lines.push(`- **${t("copyIssues")}** ${topic.issues}`);
        if (topic.discussion) lines.push(`- **${t("copyDiscussion")}** ${topic.discussion}`);
        if (topic.nextActions) lines.push(`- **${t("copyNextActions")}** ${topic.nextActions}`);
        lines.push("");
      });
    }
    
    // 決定事項
    if (summary.decisions && summary.decisions.length > 0) {
      lines.push(`## ${t("decisions")}`);
      summary.decisions.forEach(d => lines.push(`- ✓ ${d}`));
      lines.push("");
    }
    
    // アクションアイテム
    if (summary.actionItems && summary.actionItems.length > 0) {
      lines.push(`## ${t("todoActionItems")}`);
      lines.push(`| ${t("todoHeader")} | ${t("assigneeHeader")} | ${t("dueDateHeader")} |`);
      lines.push("|---|---|---|");
      summary.actionItems.forEach(item => {
        const task = item.task || item.description;
        const assignee = item.assignee || t("undecided");
        const due = item.dueDate || t("undecided");
        lines.push(`| ${task} | ${assignee} | ${due} |`);
      });
      lines.push("");
    }
    
    // 重要メモ
    if (summary.importantNotes && summary.importantNotes.length > 0) {
      lines.push(`## ${t("importantNotes")}`);
      summary.importantNotes.forEach(n => lines.push(`- 📌 ${n}`));
      lines.push("");
    }
    
    // 旧形式のoverview/keyPoints
    if (!summary.meetingInfo && summary.overview) {
      lines.push(`## ${t("overview")}`);
      lines.push(summary.overview);
      lines.push("");
    }
    if (!summary.agenda && summary.keyPoints && summary.keyPoints.length > 0) {
      lines.push(`## ${t("keyPoints")}`);
      summary.keyPoints.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
      lines.push("");
    }
    
    await handleCopy(lines.join("\n"), "summary");
  }, [summary, t, handleCopy]);

  // デフォルトタイトルを生成
  const generateDefaultTitle = useCallback(() => {
    const now = new Date();
    const dateLocale = appLocale === "ja" ? "ja-JP" : appLocale === "es" ? "es-ES" : "en-US";
    return t("recordingTitle", {
      date: now.toLocaleDateString(dateLocale),
      time: now.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" }),
    });
  }, [appLocale, t]);

  // 保存ダイアログを開く
  const openSaveDialog = useCallback(() => {
    if (!transcript) return;
    // 認証ゲート: 未ログインならモーダル表示でブロック
    if (!requireAuth(t("saveRecording"))) return;
    
    setRecordingTitle(generateDefaultTitle());
    setIsSaveDialogOpen(true);
  }, [transcript, requireAuth, t, generateDefaultTitle]);

  // 実際の保存処理
  const handleSaveWithTitle = async (customTitle: string) => {
    setIsSaveDialogOpen(false);
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const now = new Date();
      const title = customTitle.trim() || generateDefaultTitle();

      // Upload audio file to Blob Storage if available
      let audioUrl: string | undefined;
      if (audioBlob) {
        // DESIGN-4 fix: MIME タイプに応じた拡張子を使用
        const ext = audioBlob.type.includes('mp4') ? '.m4a' : audioBlob.type.includes('wav') ? '.wav' : '.webm';
        const fileName = `recording-${now.getTime()}${ext}`;
        const uploadResponse = await blobApi.uploadAudio(audioBlob, fileName);
        if (uploadResponse.success && uploadResponse.data) {
          audioUrl = uploadResponse.data.blobUrl;
        } else {
          console.warn("[Save] Audio upload failed:", uploadResponse.error);
          const continueWithout = confirm(
            t("uploadFailed", { error: uploadResponse.error || "Unknown" })
          );
          if (!continueWithout) {
            setIsSaving(false);
            return;
          }
        }
      }

      const response = await recordingsApi.createRecording({
        title,
        sourceLanguage,
        duration,
        audioUrl, // Include audio URL
        transcript: {
          segments: labeledSegments.map((seg, i) => ({
            id: seg.id,
            speaker: seg.speakerLabel || seg.speaker,
            text: seg.text,
            startTime: seg.timestamp / 1000,
            endTime: i < labeledSegments.length - 1
              ? labeledSegments[i + 1].timestamp / 1000
              : duration,
          })),
          fullText: transcript,
        },
        translations: displayTranslation ? {
          [targetLanguage]: {
            languageCode: targetLanguage,
            segments: translatedSegments.length > 0
              ? translatedSegments.map((ts) => ({
                  originalSegmentId: ts.segmentId,
                  text: ts.translatedText,
                }))
              : [{
                  originalSegmentId: "1",
                  text: displayTranslation,
                }],
            fullText: displayTranslation,
          },
        } : undefined,
      });

      setIsSaving(false);

      if (response.error) {
        console.error("[Save] Error:", response.error);
        alert(t("saveFailed", { error: response.error || "Unknown" }));
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error("[Save] Unexpected error:", err);
      alert(t("unexpectedError", { error: err instanceof Error ? err.message : String(err) }));
      setIsSaving(false);
    }
  };

  const handleSpeak = (text: string, language: string) => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speak(text, language);
    }
  };

  // DESIGN-4 fix: エラーを配列で管理（全エラーを表示） — 定義は上方で行っている

  return (
    <div className={cn(
      "mx-auto flex h-[calc(100dvh-56px)] px-4 py-2 sm:px-6 lg:px-8",
      enableAICues && showRecordingUI
        ? "max-w-7xl flex-row gap-4"
        : "max-w-5xl flex-col"
    )}>
     {/* Main content wrapper */}
     <div className="flex min-w-0 flex-1 flex-col">
      {/* API Key Warning */}
      {!hasApiKeys && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="font-medium">{t("apiKeyWarningTitle")}</span>
            {" — "}
            <span>{t("apiKeyWarningDesc")}</span>
          </div>
        </div>
      )}

      {/* Error Display */}
      {errors.length > 0 && (
        <div className="mb-2 space-y-1">
          {errors.map((err, index) => (
            <div key={index} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <p>{err}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Compact Recording Controls Bar ── */}
      <div className="flex-none rounded-lg border border-gray-200 bg-white px-4 py-2 mb-2 shadow-sm">
        {showRecordingUI ? (
          /* ─── Recording in progress: status + controls ─── */
          <div className="flex flex-wrap items-center justify-center gap-4">
            {/* Left: Recording status */}
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex items-center gap-2 text-sm font-medium",
                fsmIsPaused ? "text-yellow-600" : "text-red-600"
              )}>
                {fsmIsPaused ? (
                  <Pause className="h-4 w-4" />
                ) : isTransitioning ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                )}
                <span className="tabular-nums">{formatDuration(duration)}</span>
                <span className="hidden sm:inline text-xs text-gray-500">
                  {fsmIsPaused ? t("paused") : isTransitioning ? t("transitioning") : t("liveTranscribing")}
                </span>
              </div>
              {isRealtimeTranslation && isTranslating && translationMode === "api" && (
                <span className="text-xs text-blue-600 flex items-center gap-1">
                  <Spinner className="h-3 w-3" />
                  {t("translating")}
                </span>
              )}
              {isRealtimeTranslation && (
                <span className={cn(
                  "text-xs flex items-center gap-1 rounded-full px-2 py-0.5",
                  translationMode === "sdk"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-blue-50 text-blue-700"
                )}>
                  {translationMode === "sdk" ? (
                    <><Zap className="h-3 w-3" />{t("translationModeSdk")}</>
                  ) : (
                    <><Globe className="h-3 w-3" />{t("translationModeApi")}</>
                  )}
                </span>
              )}
            </div>

            {/* Right: Control buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fsmIsPaused ? handleResumeRecording : handlePauseRecording}
                disabled={isTransitioning || (!canPause && !canResume)}
                className={cn(
                  "gap-1.5",
                  fsmIsPaused
                    ? "border-green-300 text-green-700 hover:bg-green-50"
                    : "border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                )}
              >
                {fsmIsPaused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{fsmIsPaused ? t("resume") : t("pause")}</span>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopRecording}
                disabled={!canStop || isTransitioning}
                className="gap-1.5"
              >
                <Square className="h-4 w-4" />
                <span className="hidden sm:inline">{t("stop")}</span>
              </Button>
            </div>
          </div>
        ) : (
          /* ─── Idle: language selectors + record button ─── */
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Select
              value={sourceLanguage}
              onValueChange={setSourceLanguage}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
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

            <Languages className="h-4 w-4 text-gray-400" />

            <Select
              value={targetLanguage}
              onValueChange={setTargetLanguage}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLanguage).map(
                  (lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            {/* Divider */}
            <div className="h-6 w-px bg-gray-200" />

            {/* Real-time Translation Toggle */}
            <label className="relative inline-flex items-center cursor-pointer gap-1.5">
              <input
                type="checkbox"
                checked={isRealtimeTranslation}
                onChange={(e) => setIsRealtimeTranslation(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
              <span className="text-xs text-gray-600">
                {t("realtimeTranslation")}
              </span>
            </label>

            {/* Divider */}
            <div className="h-6 w-px bg-gray-200" />

            {/* Record button (round) */}
            <button
              onClick={handleStartRecording}
              disabled={!hasApiKeys || isTransitioning}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200",
                hasApiKeys && !isTransitioning
                  ? "bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg"
                  : "bg-gray-400 cursor-not-allowed"
              )}
              title={t("startRecording")}
            >
              <Mic className="h-5 w-5 text-white" />
            </button>
          </div>
        )}
      </div>

      {/* ── Results Tabs (fills remaining viewport) ── */}
      <Tabs defaultValue="transcript" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full flex-none grid-cols-3">
          <TabsTrigger value="transcript" className="gap-2">
            <FileText className="h-4 w-4" />
            {t("transcriptTab")}
          </TabsTrigger>
          <TabsTrigger value="translation" className="gap-2">
            <Languages className="h-4 w-4" />
            {t("translationTab")}
          </TabsTrigger>
          <TabsTrigger value="minutes" className="gap-2">
            <FileText className="h-4 w-4" />
            {t("minutesTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="flex flex-none flex-row items-center justify-between py-3">
              <CardTitle className="text-base">{t("transcriptResult")}</CardTitle>
              <div className="flex items-center gap-2">
                {transcript && !showRecordingUI && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openSaveDialog}
                    disabled={isSaving}
                    className="gap-1.5 h-7 text-xs"
                  >
                    {isSaving ? (
                      <Spinner size="sm" />
                    ) : saveSuccess ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {saveSuccess ? t("saved") : t("save")}
                  </Button>
                )}
                {transcript && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(transcript, "transcript")}
                    className="gap-1.5 h-7 text-xs"
                  >
                    {copied === "transcript" ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {t("copy")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
              {/* 話者一覧パネル（話者識別有効 & 話者検出時のみ表示） */}
              {enableSpeakerDiarization && speakers.size > 0 && (
                <div className="mb-2 flex-none rounded-md border border-gray-200 p-2">
                  <h4 className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {t("speakerList")}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(speakers.values()).map((speaker) => (
                      <div
                        key={speaker.id}
                        className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs bg-white"
                      >
                        <span className="font-bold text-gray-700">{speaker.label}</span>
                        <span className="text-gray-400">({t("speakerCount", { count: speaker.segmentCount })})</span>
                        <button
                          onClick={() => {
                            const name = prompt(t("enterSpeakerName"), speaker.label);
                            if (name && name.trim()) {
                              renameSpeaker(speaker.id, name.trim());
                            }
                          }}
                          className="ml-1 text-gray-400 hover:text-gray-600 transition-colors"
                          title={t("renameSpeaker")}
                        >
                          ✏️
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showRecordingUI ? (
                <div className="min-h-0 flex-1">
                  {segments.length === 0 && !interimTranscript ? (
                    <div className="flex items-center justify-center py-8">
                      <Spinner size="lg" />
                      <span className="ml-2 text-gray-600">{t("waitingForAudio")}</span>
                    </div>
                  ) : (
                    <TranscriptView
                      segments={labeledSegments}
                      interimTranscript={interimTranscript}
                      showSpeaker={enableSpeakerDiarization}
                      isRecording={showRecordingUI}
                      fillHeight
                    />
                  )}
                </div>
              ) : transcript ? (
                enableSpeakerDiarization && labeledSegments.length > 0 ? (
                  <TranscriptView
                    segments={labeledSegments}
                    interimTranscript=""
                    showSpeaker={enableSpeakerDiarization}
                    isRecording={false}
                    fillHeight
                  />
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                    {transcript}
                  </div>
                )
              ) : (
                <div className="py-8 text-center text-gray-500">
                  {t("emptyTranscript")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="translation" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="flex flex-none flex-row items-center justify-between py-3">
              <CardTitle className="text-base">{t("translationResult")}</CardTitle>
              <div className="flex items-center gap-2">
                {/* Issue #105: Display mode toggle - only during recording */}
                {showRecordingUI && displayTranslation && (
                  <label className="relative inline-flex items-center cursor-pointer gap-1.5">
                    <input
                      type="checkbox"
                      checked={translationDisplayMode === "full"}
                      onChange={(e) => setTranslationDisplayMode(e.target.checked ? "full" : "recent")}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="text-xs text-gray-600">
                      {t("fullDisplay")}
                    </span>
                  </label>
                )}
                {displayTranslation && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(displayTranslation, "translation")}
                    className="gap-1.5 h-7 text-xs"
                  >
                    {copied === "translation" ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {t("copy")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
              {isTranslating && !displayTranslation && !showRecordingUI ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="lg" />
                  <span className="ml-2 text-gray-600">{t("translating")}</span>
                </div>
              ) : displayTranslation ? (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <div
                    ref={translationScrollRef}
                    onScroll={handleTranslationScroll}
                    className="min-h-0 flex-1 overflow-y-auto space-y-4"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-gray-500">{t("translationLabel", { language: SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage)?.name || targetLanguage })}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSpeak(displayTranslation, targetLanguage)}
                          className="gap-1 h-7 px-2"
                          title={isSpeaking ? "停止" : "読み上げ"}
                        >
                          {isSpeaking ? (
                            <VolumeX className="h-4 w-4 text-red-500" />
                          ) : (
                            <Volume2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
                        {showRecordingUI && translationDisplayMode === "recent"
                          ? getRecentSentences(displayTranslation, 5)
                          : displayTranslation}
                      </div>
                    </div>
                    {/* Issue #105: Source section - collapsible to reduce scroll area */}
                    <details className="group" open={!showRecordingUI}>
                      <summary className="flex items-center justify-between mb-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <p className="text-sm text-gray-500 flex items-center gap-1">
                          {t("sourceLabel", { language: SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage)?.name || sourceLanguage })}
                          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.preventDefault(); handleSpeak(transcript, sourceLanguage); }}
                          className="gap-1 h-7 px-2"
                          title={isSpeaking ? "停止" : "読み上げ"}
                        >
                          {isSpeaking ? (
                            <VolumeX className="h-4 w-4 text-red-500" />
                          ) : (
                            <Volume2 className="h-4 w-4" />
                          )}
                        </Button>
                      </summary>
                      <div className="mt-2">
                        {enableSpeakerDiarization && labeledSegments.length > 0 ? (
                          <TranscriptView
                            segments={labeledSegments}
                            interimTranscript={showRecordingUI ? interimTranscript : ""}
                            showSpeaker={enableSpeakerDiarization}
                            isRecording={showRecordingUI}
                          />
                        ) : (
                          <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                            {transcript}
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                  {/* Issue #4: Follow toggle button for translation tab */}
                  {showRecordingUI && !translationAutoFollow && (
                    <div className="flex justify-center mt-2">
                      <button
                        onClick={() => setTranslationAutoFollow(true)}
                        className="flex items-center gap-1 rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-lg hover:bg-blue-700 transition-colors"
                      >
                        <ArrowDown className="h-4 w-4" />
                        {t("followLatest")}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  {t("emptyTranslation")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="minutes" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="flex flex-none flex-row items-center justify-between py-3">
              <CardTitle className="text-base">{t("minutesTitle")}</CardTitle>
              <div className="flex items-center gap-2">
                {summary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopySummary}
                    className="gap-1.5 h-7 text-xs"
                  >
                    {copied === "summary" ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied === "summary" ? t("summaryCopied") : t("copySummary")}
                  </Button>
                )}
                {transcript && !showRecordingUI && !summary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateSummary()}
                    disabled={isGeneratingSummary}
                    className="gap-1.5 h-7 text-xs"
                  >
                    {isGeneratingSummary ? (
                      <Spinner size="sm" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {isGeneratingSummary ? t("generating") : t("generateWithAI")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
              {/* テンプレート選択 & 出力言語 */}
              {transcript && !showRecordingUI && !isGeneratingSummary && (
                <div className="mb-4 space-y-3">
                  {/* 議事録出力言語 */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      {t("summaryLanguageLabel")}
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

                  {/* テンプレート選択 */}
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    {t("templateLabel")}
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
                            {tmpl.isPreset ? t(`template_${tmpl.nameKey}`) : tmpl.nameKey}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {tmpl.isPreset ? t(`template_${tmpl.descriptionKey}`) : tmpl.descriptionKey}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {summaryError && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <p>{summaryError}</p>
                </div>
              )}

              {isGeneratingSummary ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Spinner size="lg" />
                  <p className="mt-4 text-gray-600">{t("aiGenerating")}</p>
                  <p className="text-sm text-gray-500">{t("generatingTime")}</p>
                </div>
              ) : summary ? (
                <div className="space-y-6">
                  {/* 注意書き */}
                  {summary.caution && (
                    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
                      <p className="font-medium">{t("cautionNotes")}</p>
                      <p className="text-sm mt-1">{summary.caution}</p>
                    </div>
                  )}

                  {/* 1. 会議情報 */}
                  {summary.meetingInfo && (
                    <div className="rounded-md bg-gray-50 p-4">
                      <h3 className="text-sm font-medium text-gray-700 mb-3">{t("meetingInfo")}</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-gray-500">{t("meetingName")}</span> <span className="text-gray-800">{summary.meetingInfo.title}</span></div>
                        <div><span className="text-gray-500">{t("datetime")}</span> <span className="text-gray-800">{summary.meetingInfo.datetime}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">{t("participants")}</span> <span className="text-gray-800">{summary.meetingInfo.participants.join(", ") || t("unknownParticipant")}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">{t("purpose")}</span> <span className="text-gray-800">{summary.meetingInfo.purpose}</span></div>
                      </div>
                    </div>
                  )}

                  {/* 2. アジェンダ一覧 */}
                  {summary.agenda && summary.agenda.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t("agendaList")}</h3>
                      <ul className="space-y-1">
                        {summary.agenda.map((item, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm text-gray-800">
                            <span className="text-blue-600 font-medium">{index + 1}.</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 3. 議題別の詳細 */}
                  {summary.topics && summary.topics.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-3">{t("topicDetails")}</h3>
                      <div className="space-y-4">
                        {summary.topics.map((topic, index) => (
                          <div key={index} className="rounded-md border border-gray-200 p-4">
                            <h4 className="font-medium text-gray-800 mb-3">3.{index + 1}. {topic.title}</h4>
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
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 4. 決定事項 */}
                  {summary.decisions && summary.decisions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t("decisions")}</h3>
                      <ul className="space-y-2">
                        {summary.decisions.map((decision, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-green-50 p-3 text-gray-800 text-sm">
                            <span className="text-green-600">✓</span>
                            <span>{decision}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 5. ToDo / アクションアイテム */}
                  {summary.actionItems && summary.actionItems.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t("todoActionItems")}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700">{t("todoHeader")}</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700 w-24">{t("assigneeHeader")}</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700 w-28">{t("dueDateHeader")}</th>
                              <th className="border border-gray-200 px-3 py-2 text-left text-gray-700">{t("contextHeader")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.actionItems.map((item) => (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="border border-gray-200 px-3 py-2 text-gray-800">{item.task || item.description}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.assignee || t("undecided")}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.dueDate || t("undecided")}</td>
                                <td className="border border-gray-200 px-3 py-2 text-gray-600">{item.context || t("noData")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* 6. 重要メモ */}
                  {summary.importantNotes && summary.importantNotes.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t("importantNotes")}</h3>
                      <ul className="space-y-2">
                        {summary.importantNotes.map((note, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-purple-50 p-3 text-gray-800 text-sm">
                            <span className="text-purple-600">📌</span>
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 後方互換: 旧形式の overview/keyPoints があれば表示 */}
                  {!summary.meetingInfo && summary.overview && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t("overview")}</h3>
                      <div className="rounded-md bg-gray-50 p-4 text-gray-800">
                        {summary.overview}
                      </div>
                    </div>
                  )}
                  {!summary.agenda && summary.keyPoints && summary.keyPoints.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t("keyPoints")}</h3>
                      <ul className="space-y-2">
                        {summary.keyPoints.map((point, index) => (
                          <li key={index} className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-gray-800">
                            <span className="text-blue-600 font-medium">{index + 1}.</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Regenerate Button */}
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
              ) : transcript && !showRecordingUI ? (
                <div className="py-8 text-center text-gray-500">
                  <Sparkles className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                  <p>{t("emptyMinutesAction")}</p>
                  <p>{t("emptyMinutesDesc")}</p>
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  {t("emptyMinutesRecording")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 保存タイトル入力ダイアログ */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("saveDialogTitle")}</DialogTitle>
            <DialogDescription>{t("saveDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t("recordingNameLabel")}
              </label>
              <Input
                value={recordingTitle}
                onChange={(e) => setRecordingTitle(e.target.value)}
                placeholder={t("recordingNamePlaceholder")}
                maxLength={100}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveWithTitle(recordingTitle);
                  }
                }}
              />
              <p className="text-xs text-gray-500">{t("titleMaxLength")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => handleSaveWithTitle(recordingTitle)}
              disabled={isSaving}
            >
              {isSaving ? <Spinner size="sm" /> : <Save className="h-4 w-4 mr-1" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 再生成ダイアログ */}
      <Dialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("regenerateDialogTitle")}</DialogTitle>
            <DialogDescription>{t("regenerateDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* 出力言語選択 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t("summaryLanguageLabel")}
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
                {t("templateLabel")}
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
                    {tmpl.icon === "FileText" && <FileText className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "ClipboardList" && <FileText className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "CalendarCheck" && <CalendarCheck className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "Users" && <Users className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "Handshake" && <Handshake className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "Code" && <Code className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "Lightbulb" && <Lightbulb className="h-4 w-4 shrink-0" />}
                    {tmpl.icon === "PenSquare" && <PenSquare className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {tmpl.isPreset ? t(`template_${tmpl.nameKey}`) : tmpl.nameKey}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {tmpl.isPreset ? t(`template_${tmpl.descriptionKey}`) : tmpl.descriptionKey}
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

      {/* 認証ゲートモーダル */}
      <AuthGateModal
        isOpen={isModalOpen}
        onClose={closeModal}
        action={blockedAction}
      />
     </div>

      {/* AI Cues Side Panel (Issue #89) */}
      {enableAICues && showRecordingUI && (
        <div className="hidden flex-none lg:flex">
          <AICuesPanel
            cues={aiCues}
            isLoading={isCuesLoading}
            error={cuesError}
            callCount={cuesCallCount}
            isRecording={showRecordingUI}
            enabled={enableAICues}
          />
        </div>
      )}
    </div>
  );
}
