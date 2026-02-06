"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Mic, Square, Languages, FileText, Copy, Check, AlertCircle, Save, Sparkles, Pause, Play, Volume2, VolumeX } from "lucide-react";
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
import { SUPPORTED_LANGUAGES, speechConfig, translatorConfig } from "@/lib/config";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useTranslation } from "@/hooks/useTranslation";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { recordingsApi, summaryApi, blobApi } from "@/services";
import { Summary } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const { settings } = useAuth();
  
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
  const [copied, setCopied] = useState<"transcript" | "translation" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isRealtimeTranslation, setIsRealtimeTranslation] = useState(true);
  
  // Ref to track last translated text to avoid redundant translations
  const lastTranslatedTextRef = useRef<string>("");
  const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Speech Recognition
  const {
    isListening,
    isPaused,
    transcript,
    // transcriptSegments, // Reserved for future use with detailed speaker view
    interimTranscript,
    error: speechError,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    resetTranscript,
  } = useSpeechRecognition({
    subscriptionKey: speechConfig.subscriptionKey,
    region: speechConfig.region,
    language: sourceLanguage,
  });

  // Audio Recording (for saving audio files)
  const {
    audioBlob,
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    pauseRecording: pauseAudioRecording,
    resumeRecording: resumeAudioRecording,
    resetRecording: resetAudioRecording,
  } = useAudioRecorder();

  // Translation
  const {
    isTranslating,
    error: translationError,
    translate,
  } = useTranslation({
    subscriptionKey: translatorConfig.subscriptionKey,
    region: translatorConfig.region,
  });

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

  // Duration counter (pauses when isPaused)
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isListening && !isPaused) {
      interval = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isListening, isPaused]);

  // Auto-translate when transcript changes (real-time translation)
  useEffect(() => {
    const textToTranslate = transcript || interimTranscript;
    
    // Skip if no text or same as last translated
    if (!textToTranslate || textToTranslate === lastTranslatedTextRef.current) {
      return;
    }

    // Clear previous timeout
    if (translationTimeoutRef.current) {
      clearTimeout(translationTimeoutRef.current);
    }

    // If recording stopped, translate immediately
    if (!isListening && transcript) {
      lastTranslatedTextRef.current = transcript;
      translate(transcript, sourceLanguage, targetLanguage).then((result) => {
        if (result) {
          setTranslatedText(result);
        }
      });
      return;
    }

    // Real-time translation with debounce (500ms delay to avoid too many API calls)
    if (isListening && isRealtimeTranslation && textToTranslate) {
      translationTimeoutRef.current = setTimeout(async () => {
        lastTranslatedTextRef.current = textToTranslate;
        const result = await translate(textToTranslate, sourceLanguage, targetLanguage);
        if (result) {
          setTranslatedText(result);
        }
      }, 500);
    }

    return () => {
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
      }
    };
  }, [transcript, interimTranscript, isListening, sourceLanguage, targetLanguage, translate, isRealtimeTranslation]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartRecording = async () => {
    setDuration(0);
    setTranslatedText("");
    setSaveSuccess(false);
    setSummary(null);
    setSummaryError(null);
    lastTranslatedTextRef.current = "";
    resetTranscript();
    resetAudioRecording();
    
    // Start both speech recognition and audio recording
    startListening();
    await startAudioRecording();
  };

  const handleStopRecording = () => {
    stopListening();
    stopAudioRecording();
  };

  const handlePauseRecording = () => {
    pauseListening();
    pauseAudioRecording();
  };

  const handleResumeRecording = () => {
    resumeListening();
    resumeAudioRecording();
  };

  const handleGenerateSummary = async () => {
    if (!transcript) return;

    setIsGeneratingSummary(true);
    setSummaryError(null);

    const response = await summaryApi.generateSummary({
      transcript,
      language: sourceLanguage,
    });

    setIsGeneratingSummary(false);

    if (response.error) {
      setSummaryError(response.error);
    } else if (response.data) {
      setSummary(response.data);
    }
  };

  const handleCopy = useCallback(async (text: string, type: "transcript" | "translation") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleSave = async () => {
    if (!transcript) return;

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const now = new Date();
      const title = `録音 ${now.toLocaleDateString("ja-JP")} ${now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;

      // Upload audio file to Blob Storage if available
      let audioUrl: string | undefined;
      if (audioBlob) {
        console.log("[Save] Uploading audio blob...");
        const fileName = `recording-${now.getTime()}.webm`;
        const uploadResponse = await blobApi.uploadAudio(audioBlob, fileName);
        console.log("[Save] Upload response:", uploadResponse);
        if (uploadResponse.success && uploadResponse.data) {
          audioUrl = uploadResponse.data.blobUrl;
        } else {
          console.warn("[Save] Audio upload failed, continuing without audio URL:", uploadResponse.error);
        }
      }

      console.log("[Save] Creating recording...", { title, sourceLanguage, duration, audioUrl });
      const response = await recordingsApi.createRecording({
        title,
        sourceLanguage,
        duration,
        audioUrl, // Include audio URL
        transcript: {
          segments: [{
            id: "1",
            text: transcript,
            startTime: 0,
            endTime: duration,
          }],
          fullText: transcript,
        },
        translations: translatedText ? {
          [targetLanguage]: {
            languageCode: targetLanguage,
            segments: [{
              originalSegmentId: "1",
              text: translatedText,
            }],
            fullText: translatedText,
          },
        } : undefined,
      });

      console.log("[Save] Create recording response:", response);

      setIsSaving(false);

      if (response.error) {
        console.error("[Save] Error:", response.error);
        alert(`保存に失敗しました: ${response.error}`);
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error("[Save] Unexpected error:", err);
      alert(`予期しないエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`);
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

  const error = speechError || translationError || ttsError;
  const hasApiKeys = speechConfig.subscriptionKey && translatorConfig.subscriptionKey;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
          AI Voice Recorder
        </h1>
        <p className="mt-2 text-gray-600">
          音声を録音して、リアルタイムで文字起こし＆翻訳
        </p>
      </div>

      {/* API Key Warning */}
      {!hasApiKeys && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-medium">API設定が必要です</p>
            <p className="text-sm">
              .env.local ファイルに Azure Speech Services と Translator の API キーを設定してください。
            </p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Recording Controls */}
      <Card className="mb-6">
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-6">
            {/* Recording Buttons */}
            <div className="flex items-center gap-4">
              {/* Pause/Resume Button (visible during recording) */}
              {isListening && (
                <button
                  onClick={isPaused ? handleResumeRecording : handlePauseRecording}
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-full transition-all duration-200",
                    isPaused
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-yellow-500 hover:bg-yellow-600"
                  )}
                  title={isPaused ? "再開" : "一時停止"}
                >
                  {isPaused ? (
                    <Play className="h-6 w-6 text-white" />
                  ) : (
                    <Pause className="h-6 w-6 text-white" />
                  )}
                </button>
              )}

              {/* Main Recording Button */}
              <div className="relative">
                <button
                  onClick={isListening ? handleStopRecording : handleStartRecording}
                  disabled={!hasApiKeys}
                  className={cn(
                    "flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200",
                    isListening
                      ? isPaused 
                        ? "bg-orange-500 hover:bg-orange-600"
                        : "bg-red-500 hover:bg-red-600 animate-pulse"
                      : hasApiKeys
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-gray-400 cursor-not-allowed"
                  )}
                >
                  {isListening ? (
                    <Square className="h-10 w-10 text-white" />
                  ) : (
                    <Mic className="h-10 w-10 text-white" />
                  )}
                </button>
                {isListening && (
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700">
                    {formatDuration(duration)}
                  </span>
                )}
              </div>

              {/* Spacer for symmetry when recording */}
              {isListening && <div className="w-14" />}
            </div>

            {/* Status */}
            {isListening && (
              <div className={cn(
                "flex items-center gap-2 text-sm",
                isPaused ? "text-yellow-600" : "text-green-600"
              )}>
                {isPaused ? (
                  <>
                    <Pause className="h-4 w-4" />
                    一時停止中...
                  </>
                ) : (
                  <>
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    リアルタイム文字起こし中...
                  </>
                )}
              </div>
            )}

            {/* Language Selection */}
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  入力言語:
                </label>
                <Select 
                  value={sourceLanguage} 
                  onValueChange={setSourceLanguage}
                  disabled={isListening}
                >
                  <SelectTrigger className="w-40">
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

              <Languages className="h-5 w-5 text-gray-400" />

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  翻訳先:
                </label>
                <Select 
                  value={targetLanguage} 
                  onValueChange={setTargetLanguage}
                  disabled={isListening}
                >
                  <SelectTrigger className="w-40">
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
              </div>
            </div>

            {/* Real-time Translation Toggle */}
            <div className="flex items-center gap-3 mt-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRealtimeTranslation}
                  onChange={(e) => setIsRealtimeTranslation(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                <span className="ml-3 text-sm font-medium text-gray-700">
                  リアルタイム翻訳
                </span>
              </label>
              {isRealtimeTranslation && isListening && isTranslating && (
                <span className="text-xs text-blue-600 flex items-center gap-1">
                  <Spinner className="h-3 w-3" />
                  翻訳中...
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Tabs */}
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
          <TabsTrigger value="minutes" className="gap-2">
            <FileText className="h-4 w-4" />
            議事録
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">文字起こし結果</CardTitle>
              <div className="flex items-center gap-2">
                {transcript && !isListening && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="gap-2"
                  >
                    {isSaving ? (
                      <Spinner size="sm" />
                    ) : saveSuccess ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {saveSuccess ? "保存完了" : "保存"}
                  </Button>
                )}
                {transcript && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(transcript, "transcript")}
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
              </div>
            </CardHeader>
            <CardContent>
              {isListening ? (
                <div className="space-y-2">
                  {transcript && (
                    <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                      {transcript}
                    </div>
                  )}
                  {interimTranscript && (
                    <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-blue-600 italic">
                      {interimTranscript}
                    </div>
                  )}
                  {!transcript && !interimTranscript && (
                    <div className="flex items-center justify-center py-8">
                      <Spinner size="lg" />
                      <span className="ml-2 text-gray-600">音声を待っています...</span>
                    </div>
                  )}
                </div>
              ) : transcript ? (
                <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                  {transcript}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  録音を開始すると、ここにリアルタイムで文字起こし結果が表示されます
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="translation">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">翻訳結果</CardTitle>
              {translatedText && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(translatedText, "translation")}
                  className="gap-2"
                >
                  {copied === "translation" ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  コピー
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {isTranslating ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="lg" />
                  <span className="ml-2 text-gray-600">翻訳中...</span>
                </div>
              ) : translatedText ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-gray-500">原文（{SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage)?.name}）:</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSpeak(transcript, sourceLanguage)}
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
                    <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                      {transcript}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-gray-500">翻訳（{SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage)?.name}）:</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSpeak(translatedText, targetLanguage)}
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
                      {translatedText}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  録音完了後、自動的に翻訳されます
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="minutes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">議事録</CardTitle>
              {transcript && !isListening && !summary && (
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
                  {isGeneratingSummary ? "生成中..." : "AIで議事録を生成"}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {summaryError && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <p>{summaryError}</p>
                </div>
              )}

              {isGeneratingSummary ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Spinner size="lg" />
                  <p className="mt-4 text-gray-600">AIが議事録を生成しています...</p>
                  <p className="text-sm text-gray-500">数秒から数十秒かかる場合があります</p>
                </div>
              ) : summary ? (
                <div className="space-y-6">
                  {/* Overview */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">概要</h3>
                    <div className="rounded-md bg-gray-50 p-4 text-gray-800">
                      {summary.overview}
                    </div>
                  </div>

                  {/* Key Points */}
                  {summary.keyPoints && summary.keyPoints.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">重要ポイント</h3>
                      <ul className="space-y-2">
                        {summary.keyPoints.map((point, index) => (
                          <li
                            key={index}
                            className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-gray-800"
                          >
                            <span className="text-blue-600 font-medium">{index + 1}.</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Action Items */}
                  {summary.actionItems && summary.actionItems.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">アクションアイテム</h3>
                      <ul className="space-y-2">
                        {summary.actionItems.map((item) => (
                          <li
                            key={item.id}
                            className="rounded-md border border-green-200 bg-green-50 p-3"
                          >
                            <p className="text-gray-800">{item.description}</p>
                            <div className="mt-2 flex gap-4 text-sm text-gray-600">
                              {item.assignee && (
                                <span>担当: {item.assignee}</span>
                              )}
                              {item.dueDate && (
                                <span>期限: {item.dueDate}</span>
                              )}
                            </div>
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
                      onClick={handleGenerateSummary}
                      disabled={isGeneratingSummary}
                      className="gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      再生成
                    </Button>
                  </div>
                </div>
              ) : transcript && !isListening ? (
                <div className="py-8 text-center text-gray-500">
                  <Sparkles className="mx-auto h-12 w-12 text-gray-300 mb-4" />
                  <p>「AIで議事録を生成」ボタンをクリックして</p>
                  <p>文字起こしから議事録を自動生成できます</p>
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  録音完了後、AIが議事録を自動生成します
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
