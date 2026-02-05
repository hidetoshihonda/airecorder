"use client";

import { useState, useEffect, useCallback } from "react";
import { Mic, Square, Languages, FileText, Copy, Check, AlertCircle } from "lucide-react";
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
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const [sourceLanguage, setSourceLanguage] = useState("ja-JP");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [translatedText, setTranslatedText] = useState("");
  const [copied, setCopied] = useState<"transcript" | "translation" | null>(null);

  // Speech Recognition
  const {
    isListening,
    transcript,
    interimTranscript,
    error: speechError,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition({
    subscriptionKey: speechConfig.subscriptionKey,
    region: speechConfig.region,
    language: sourceLanguage,
  });

  // Translation
  const {
    isTranslating,
    error: translationError,
    translate,
  } = useTranslation({
    subscriptionKey: translatorConfig.subscriptionKey,
    region: translatorConfig.region,
  });

  // Duration counter
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isListening) {
      interval = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  // Auto-translate when transcript changes
  useEffect(() => {
    const translateText = async () => {
      if (transcript && !isListening) {
        const result = await translate(transcript, sourceLanguage, targetLanguage);
        if (result) {
          setTranslatedText(result);
        }
      }
    };
    translateText();
  }, [transcript, isListening, sourceLanguage, targetLanguage, translate]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartRecording = () => {
    setDuration(0);
    setTranslatedText("");
    resetTranscript();
    startListening();
  };

  const handleStopRecording = () => {
    stopListening();
  };

  const handleCopy = useCallback(async (text: string, type: "transcript" | "translation") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const error = speechError || translationError;
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
            {/* Recording Button */}
            <div className="relative">
              <button
                onClick={isListening ? handleStopRecording : handleStartRecording}
                disabled={!hasApiKeys}
                className={cn(
                  "flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200",
                  isListening
                    ? "bg-red-500 hover:bg-red-600 animate-pulse"
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

            {/* Status */}
            {isListening && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                リアルタイム文字起こし中...
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
                    <p className="text-sm text-gray-500 mb-1">原文（{SUPPORTED_LANGUAGES.find(l => l.code === sourceLanguage)?.name}）:</p>
                    <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                      {transcript}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">翻訳（{SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage)?.name}）:</p>
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
            <CardHeader>
              <CardTitle className="text-lg">議事録</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="py-8 text-center text-gray-500">
                録音完了後、AIが議事録を自動生成します（Coming Soon）
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
