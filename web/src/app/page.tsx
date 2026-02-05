"use client";

import { useState, useEffect } from "react";
import { Mic, Square, Languages, FileText, Play, Pause } from "lucide-react";
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
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { useRecorder } from "@/hooks/useRecorder";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const { isRecording, isPaused, duration, audioBlob, startRecording, stopRecording, pauseRecording, resumeRecording } = useRecorder();
  const [sourceLanguage, setSourceLanguage] = useState("ja-JP");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [isTranscribing, _setIsTranscribing] = useState(false);
  const [transcript, _setTranscript] = useState("");

  // Handle audio blob when recording stops
  useEffect(() => {
    if (audioBlob) {
      // TODO: Process the recorded audio
      console.warn("Recording stopped, blob size:", audioBlob.size);
    }
  }, [audioBlob]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartRecording = async () => {
    try {
      await startRecording();
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  };

  const handleStopRecording = () => {
    stopRecording();
  };

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

      {/* Recording Controls */}
      <Card className="mb-6">
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-6">
            {/* Recording Button */}
            <div className="relative">
              <button
                onClick={isRecording ? handleStopRecording : handleStartRecording}
                className={cn(
                  "flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200",
                  isRecording
                    ? "bg-red-500 hover:bg-red-600 animate-pulse"
                    : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {isRecording ? (
                  <Square className="h-10 w-10 text-white" />
                ) : (
                  <Mic className="h-10 w-10 text-white" />
                )}
              </button>
              {isRecording && (
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700">
                  {formatDuration(duration)}
                </span>
              )}
            </div>

            {/* Recording Status */}
            <div className="flex items-center gap-4">
              {isRecording && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    className="gap-2"
                  >
                    {isPaused ? (
                      <>
                        <Play className="h-4 w-4" />
                        再開
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4" />
                        一時停止
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>

            {/* Language Selection */}
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  入力言語:
                </label>
                <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
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
                <Select value={targetLanguage} onValueChange={setTargetLanguage}>
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
            <CardHeader>
              <CardTitle className="text-lg">文字起こし結果</CardTitle>
            </CardHeader>
            <CardContent>
              {isTranscribing ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="lg" />
                  <span className="ml-2 text-gray-600">文字起こし中...</span>
                </div>
              ) : transcript ? (
                <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
                  {transcript}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  録音を開始すると、ここに文字起こし結果が表示されます
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="translation">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">翻訳結果</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="py-8 text-center text-gray-500">
                翻訳結果がここに表示されます
              </div>
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
                録音完了後、AIが議事録を自動生成します
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
