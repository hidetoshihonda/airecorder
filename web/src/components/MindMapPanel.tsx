"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Sparkles,
  RefreshCw,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { mindmapApi } from "@/services/mindmapApi";
import { recordingsApi } from "@/services";
import { Recording } from "@/types";

interface MindMapPanelProps {
  recording: Recording;
  transcript: string;
  onRecordingUpdate: (r: Recording) => void;
}

export function MindMapPanel({
  recording,
  transcript,
  onRecordingUpdate,
}: MindMapPanelProps) {
  const t = useTranslations("RecordingDetail");
  const svgRef = useRef<SVGSVGElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markmapRef = useRef<any>(null);

  const markdown = recording.mindmapMarkdown;

  // markmap レンダリング（CSR のみ）
  const renderMindmap = useCallback(async (md: string) => {
    if (!svgRef.current || !md) return;

    try {
      const { Transformer } = await import("markmap-lib");
      const { Markmap } = await import("markmap-view");

      const transformer = new Transformer();
      const { root } = transformer.transform(md);

      // 既存インスタンスをクリア
      svgRef.current.innerHTML = "";

      const mm = Markmap.create(
        svgRef.current,
        {
          autoFit: true,
          duration: 500,
          maxWidth: 300,
          paddingX: 16,
        },
        root
      );

      markmapRef.current = mm;
    } catch (err) {
      console.error("Markmap render error:", err);
      setError(t("mindmapRenderError"));
    }
  }, [t]);

  // markdown が変わったらレンダリング
  useEffect(() => {
    if (markdown) {
      renderMindmap(markdown);
    }
  }, [markdown, renderMindmap]);

  // 生成ハンドラ
  const handleGenerate = async () => {
    if (!transcript) return;
    setIsGenerating(true);
    setError(null);

    const response = await mindmapApi.generateMindmap({
      transcript,
      language: recording.sourceLanguage,
    });

    if (response.error) {
      setError(response.error);
      setIsGenerating(false);
      return;
    }

    if (response.data?.markdown) {
      // キャッシュ保存
      const updateResponse = await recordingsApi.updateRecording(
        recording.id,
        { mindmapMarkdown: response.data.markdown }
      );

      if (updateResponse.data) {
        onRecordingUpdate(updateResponse.data);
      }

      await renderMindmap(response.data.markdown);
    }

    setIsGenerating(false);
  };

  // SVG エクスポート
  const handleExportSvg = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recording.title || "mindmap"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // フィットボタン
  const handleFit = () => {
    if (markmapRef.current && typeof markmapRef.current.fit === "function") {
      markmapRef.current.fit();
    }
  };

  // ズーム操作
  const handleZoom = (direction: "in" | "out") => {
    if (
      markmapRef.current &&
      typeof markmapRef.current.rescale === "function"
    ) {
      markmapRef.current.rescale(direction === "in" ? 1.25 : 0.8);
    }
  };

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      {markdown && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={isGenerating || !transcript}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${isGenerating ? "animate-spin" : ""}`}
            />
            {t("regenerate")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportSvg}>
            <Download className="h-4 w-4 mr-1" />
            SVG
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleZoom("out")}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleZoom("in")}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleFit}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* マインドマップ表示 or 生成ボタン */}
      {markdown ? (
        <div
          className="rounded-md border bg-white p-2 overflow-hidden"
          style={{ minHeight: "400px" }}
        >
          <svg
            ref={svgRef}
            className="w-full"
            style={{ minHeight: "400px" }}
          />
        </div>
      ) : (
        <div className="py-12 text-center text-gray-500">
          {transcript ? (
            <>
              <Sparkles className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="mb-4">{t("mindmapEmpty")}</p>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="gap-2"
              >
                {isGenerating ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    {t("mindmapGenerating")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {t("mindmapGenerate")}
                  </>
                )}
              </Button>
            </>
          ) : (
            <p>{t("mindmapNoTranscript")}</p>
          )}
        </div>
      )}
    </div>
  );
}
