# Issue #89: AI Cues 録音中のリアルタイム文脈補助 — 実装計画書

> **Issue**: [#89](https://github.com/hidetoshihonda/airecorder/issues/89)
> **分析レビュー**: [Issue89_AI_Cues_リアルタイム文脈補助_分析レビュー.md](Issue89_AI_Cues_リアルタイム文脈補助_分析レビュー.md)
> **作成日**: 2026-02-15
> **見積り**: Phase 1 — 約3日 (21.5h)

---

## 概要

録音中にAIがリアルタイムで会話の文脈を解析し、専門用語の解説(Concept)・人物情報(Bio)・回答提案(Suggestion)をサイドパネルに自動表示する機能を実装する。

---

## 実装方針

### Phase 1 (本PR) — MVP

- **通常のJSON POST** でOpenAI呼び出し（SSEストリーミングはPhase 2）
- **折りたたみ可能なサイドパネル**（デスクトップ: 右カラム / モバイル: 折りたたみ）
- **バッチ + デバウンス + セッション上限**によるコスト制御
- **設定画面でON/OFF切替**

---

## Step 1: 型定義の追加

### 1.1 `web/src/types/index.ts` — AICue 型定義

既存の型定義ファイルの末尾に以下を追加:

```typescript
// ─── AI Cues Types (Issue #89) ───

export type CueType = "concept" | "bio" | "suggestion";

export interface BaseCue {
  id: string;
  type: CueType;
  timestamp: number;
  segmentIndex: number;
}

export interface ConceptCue extends BaseCue {
  type: "concept";
  term: string;
  definition: string;
  context?: string;
}

export interface BioCue extends BaseCue {
  type: "bio";
  name: string;
  description: string;
  role?: string;
}

export interface SuggestionCue extends BaseCue {
  type: "suggestion";
  question: string;
  suggestion: string;
  reasoning?: string;
}

export type AICue = ConceptCue | BioCue | SuggestionCue;
```

### 1.2 `web/src/types/index.ts` — UserSettings 拡張

`UserSettings` インターフェースに追加:

```typescript
export interface UserSettings {
  // ... 既存フィールド ...
  enableAICues?: boolean;  // AI Cues ON/OFF（デフォルト: false）
}
```

### 1.3 `web/src/contexts/AuthContext.tsx` — defaultSettings 更新

```typescript
const defaultSettings: UserSettings = {
  // ... 既存フィールド ...
  enableAICues: false,
};
```

---

## Step 2: バックエンドAPI

### 2.1 `api/src/functions/cues.ts` (新規作成)

```typescript
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

interface CuesRequest {
  segments: string[];    // 直近の確定セグメントテキスト
  language: string;      // ソース言語 (例: "ja-JP")
  context?: string;      // オプション: 会議テーマ等
}

interface CueItem {
  type: "concept" | "bio" | "suggestion";
  // concept
  term?: string;
  definition?: string;
  context?: string;
  // bio
  name?: string;
  description?: string;
  role?: string;
  // suggestion
  question?: string;
  suggestion?: string;
  reasoning?: string;
}

interface CuesResponse {
  cues: CueItem[];
}

function jsonResponse<T>(
  data: { success: boolean; data?: T; error?: string },
  status: number = 200
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    body: JSON.stringify(data),
  };
}

const CUES_SYSTEM_PROMPT = `あなたは会議中のリアルタイムアシスタントです。
与えられた会話テキスト（直近の発言セグメント）を分析し、以下の3種類の「AI Cue」を抽出してください。

## 出力形式（JSON）
{
  "cues": [
    {
      "type": "concept",
      "term": "専門用語・略語",
      "definition": "簡潔な解説（1-2文）",
      "context": "会話中での使われ方"
    },
    {
      "type": "bio",
      "name": "人物名・組織名",
      "description": "簡潔なプロフィール（1-2文）",
      "role": "会話中での関係性・役職"
    },
    {
      "type": "suggestion",
      "question": "相手の質問・論点",
      "suggestion": "回答案・フォローアップ提案",
      "reasoning": "提案の根拠（1文）"
    }
  ]
}

## ルール
1. 一般的な単語は concept にしない（専門用語・業界用語・略語のみ）
2. 明確に言及された人物・組織のみ bio にする（推測で追加しない）
3. suggestion は相手の質問や検討事項に対する具体的で実用的な回答案を出す
4. cues が何もなければ空配列 [] を返す
5. 各 type は最大3件まで
6. 必ず有効なJSONで出力
7. 解説は簡潔に（各フィールド50文字以内推奨）`;

function getLanguageInstruction(language: string): string {
  if (language.startsWith("ja")) return "";
  const langMap: Record<string, string> = {
    "en-US": "English", "en-GB": "English",
    "es-ES": "Spanish", "es-MX": "Spanish",
    "zh-CN": "Chinese", "zh-TW": "Chinese",
    "ko-KR": "Korean",
    "fr-FR": "French",
    "de-DE": "German",
    "pt-BR": "Portuguese",
    "it-IT": "Italian",
    "ar-SA": "Arabic",
  };
  const langName = langMap[language] || language;
  return `\n\n重要：出力は${langName}で記述してください。`;
}

app.http("generateCues", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "cues/generate",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as CuesRequest;

      if (!body.segments || body.segments.length === 0) {
        return jsonResponse(
          { success: false, error: "segments array is required" },
          400
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_CUES_DEPLOYMENT_NAME ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        "gpt-4o-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      const systemPrompt =
        CUES_SYSTEM_PROMPT + getLanguageInstruction(body.language);

      const segmentsText = body.segments
        .map((s, i) => `[${i + 1}] ${s}`)
        .join("\n");

      const userMessage = body.context
        ? `会議テーマ: ${body.context}\n\n直近の発言:\n${segmentsText}`
        : `直近の発言:\n${segmentsText}`;

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      const parsed = JSON.parse(content) as CuesResponse;

      return jsonResponse<CuesResponse>({
        success: true,
        data: { cues: parsed.cues || [] },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

### 2.2 `api/src/index.ts` — import追加

```typescript
import "./functions/cues";
```

---

## Step 3: フロントエンド サービス層

### 3.1 `web/src/services/cuesApi.ts` (新規作成)

```typescript
import { AICue, ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface GenerateCuesInput {
  segments: string[];
  language: string;
  context?: string;
}

interface CuesApiResponse {
  cues: Array<{
    type: "concept" | "bio" | "suggestion";
    term?: string;
    definition?: string;
    context?: string;
    name?: string;
    description?: string;
    role?: string;
    question?: string;
    suggestion?: string;
    reasoning?: string;
  }>;
}

class CuesApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async generateCues(
    input: GenerateCuesInput,
    signal?: AbortSignal
  ): Promise<ApiResponse<CuesApiResponse>> {
    const url = `${this.baseUrl}/cues/generate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: `JSON parse error: ${text.substring(0, 100)}` };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return { data: data?.data as CuesApiResponse };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { error: "REQUEST_ABORTED" };
      }
      return { error: (err as Error).message };
    }
  }
}

export const cuesApi = new CuesApiService();
```

### 3.2 `web/src/services/index.ts` — エクスポート追加

既存のバレルファイルに追加:

```typescript
export { cuesApi } from "./cuesApi";
```

---

## Step 4: `useAICues` カスタムフック

### 4.1 `web/src/hooks/useAICues.ts` (新規作成)

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AICue, LiveSegment } from "@/types";
import { cuesApi } from "@/services/cuesApi";

// ─── 設定定数 ───
const BATCH_SIZE = 5;               // N セグメントごとにAPI呼び出し
const DEBOUNCE_MS = 5000;           // デバウンス間隔（5秒）
const MAX_CALLS_PER_SESSION = 20;   // 1録音セッションの上限
const CONTEXT_WINDOW = 20;          // 直近20セグメントのみ送信

export interface UseAICuesOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  enabled: boolean;
  isRecording: boolean;
}

export interface UseAICuesReturn {
  cues: AICue[];
  isLoading: boolean;
  error: string | null;
  callCount: number;
  clearCues: () => void;
}

export function useAICues({
  segments,
  sourceLanguage,
  enabled,
  isRecording,
}: UseAICuesOptions): UseAICuesReturn {
  const [cues, setCues] = useState<AICue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for stable state across closures
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const lastProcessedIndexRef = useRef(0);
  const callCountRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cueIdCounterRef = useRef(0);

  // Reset on new recording session
  useEffect(() => {
    if (isRecording) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCues([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null);
      lastProcessedIndexRef.current = 0;
      callCountRef.current = 0;
      cueIdCounterRef.current = 0;
    }
  }, [isRecording]);

  // Cleanup on unmount or recording stop
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Core: fetch AI Cues from API
  const fetchCues = useCallback(async (segmentTexts: string[]) => {
    if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

    // Abort previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);
    callCountRef.current += 1;

    try {
      const response = await cuesApi.generateCues(
        {
          segments: segmentTexts,
          language: sourceLanguage,
        },
        controller.signal
      );

      if (controller.signal.aborted) return;

      if (response.error) {
        if (response.error !== "REQUEST_ABORTED") {
          setError(response.error);
        }
        return;
      }

      if (response.data?.cues && response.data.cues.length > 0) {
        const now = Date.now();
        const newCues: AICue[] = response.data.cues.map((raw) => {
          const id = `cue-${++cueIdCounterRef.current}`;
          const base = {
            id,
            timestamp: now,
            segmentIndex: segmentsRef.current.length - 1,
          };

          switch (raw.type) {
            case "concept":
              return {
                ...base,
                type: "concept" as const,
                term: raw.term || "",
                definition: raw.definition || "",
                context: raw.context,
              };
            case "bio":
              return {
                ...base,
                type: "bio" as const,
                name: raw.name || "",
                description: raw.description || "",
                role: raw.role,
              };
            case "suggestion":
              return {
                ...base,
                type: "suggestion" as const,
                question: raw.question || "",
                suggestion: raw.suggestion || "",
                reasoning: raw.reasoning,
              };
            default:
              return {
                ...base,
                type: "concept" as const,
                term: "Unknown",
                definition: "",
              };
          }
        });

        setCues((prev) => [...prev, ...newCues]);
      }
    } catch {
      // Network error, etc.
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [sourceLanguage]);

  // Watch segments and trigger batch + debounce
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

    const newCount = segments.length - lastProcessedIndexRef.current;
    if (newCount < BATCH_SIZE) return;

    // Clear existing debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const currentSegments = segmentsRef.current;
      const startIdx = Math.max(0, currentSegments.length - CONTEXT_WINDOW);
      const segmentTexts = currentSegments
        .slice(startIdx)
        .map((s) => s.text);

      lastProcessedIndexRef.current = currentSegments.length;
      fetchCues(segmentTexts);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [segments.length, enabled, isRecording, fetchCues]);

  // Abort on recording stop
  useEffect(() => {
    if (!isRecording) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    }
  }, [isRecording]);

  const clearCues = useCallback(() => {
    setCues([]);
    setError(null);
    lastProcessedIndexRef.current = 0;
    callCountRef.current = 0;
  }, []);

  return {
    cues,
    isLoading,
    error,
    callCount: callCountRef.current,
    clearCues,
  };
}
```

---

## Step 5: `AICuesPanel` UIコンポーネント

### 5.1 `web/src/components/AICuesPanel.tsx` (新規作成)

```tsx
"use client";

import { memo, useRef, useEffect, useState } from "react";
import {
  Lightbulb,
  User,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AICue, ConceptCue, BioCue, SuggestionCue } from "@/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// ─── CueCard コンポーネント ───

const ConceptCard = memo(function ConceptCard({ cue }: { cue: ConceptCue }) {
  const t = useTranslations("AICues");
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Lightbulb className="h-4 w-4 text-amber-600" />
        <span className="text-xs font-bold text-amber-800">{t("concept")}</span>
      </div>
      <p className="text-sm font-semibold text-gray-800">{cue.term}</p>
      <p className="text-xs text-gray-600 mt-1">{cue.definition}</p>
      {cue.context && (
        <p className="text-xs text-gray-400 mt-1 italic">💬 {cue.context}</p>
      )}
    </div>
  );
});

const BioCard = memo(function BioCard({ cue }: { cue: BioCue }) {
  const t = useTranslations("AICues");
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <User className="h-4 w-4 text-blue-600" />
        <span className="text-xs font-bold text-blue-800">{t("bio")}</span>
      </div>
      <p className="text-sm font-semibold text-gray-800">{cue.name}</p>
      {cue.role && (
        <p className="text-xs text-blue-700 mt-0.5">{cue.role}</p>
      )}
      <p className="text-xs text-gray-600 mt-1">{cue.description}</p>
    </div>
  );
});

const SuggestionCard = memo(function SuggestionCard({
  cue,
}: {
  cue: SuggestionCue;
}) {
  const t = useTranslations("AICues");
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-4 w-4 text-green-600" />
        <span className="text-xs font-bold text-green-800">
          {t("suggestion")}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-1">❓ {cue.question}</p>
      <p className="text-sm text-gray-800">{cue.suggestion}</p>
      {cue.reasoning && (
        <p className="text-xs text-gray-400 mt-1 italic">
          📎 {cue.reasoning}
        </p>
      )}
    </div>
  );
});

function CueCard({ cue }: { cue: AICue }) {
  switch (cue.type) {
    case "concept":
      return <ConceptCard cue={cue} />;
    case "bio":
      return <BioCard cue={cue} />;
    case "suggestion":
      return <SuggestionCard cue={cue} />;
  }
}

// ─── AICuesPanel メインコンポーネント ───

interface AICuesPanelProps {
  cues: AICue[];
  isLoading: boolean;
  error: string | null;
  callCount: number;
  isRecording: boolean;
  enabled: boolean;
  onToggle?: () => void;
}

export function AICuesPanel({
  cues,
  isLoading,
  error,
  callCount,
  isRecording,
  enabled,
  onToggle,
}: AICuesPanelProps) {
  const t = useTranslations("AICues");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-scroll to latest cue
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [cues.length]);

  if (!enabled) return null;

  // Collapsed state — show toggle button only
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-3 shadow-sm hover:bg-gray-50 transition-colors"
        title={t("expandPanel")}
      >
        <ChevronLeft className="h-4 w-4 text-gray-500" />
        <Sparkles className="h-4 w-4 text-purple-500" />
        {cues.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
            {cues.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex w-80 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold text-gray-700">
            {t("title")}
          </span>
          {isLoading && <Spinner className="h-3 w-3" />}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">
            {callCount}/20
          </span>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title={t("collapsePanel")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Cue List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-center gap-1">
            <X className="h-3 w-3" />
            {error}
          </div>
        )}

        {cues.length === 0 && !isLoading && isRecording && (
          <div className="py-8 text-center text-gray-400 text-xs">
            <Sparkles className="mx-auto h-8 w-8 text-gray-300 mb-2" />
            <p>{t("waitingForCues")}</p>
            <p className="mt-1 text-gray-300">{t("waitingDescription")}</p>
          </div>
        )}

        {cues.length === 0 && !isRecording && (
          <div className="py-8 text-center text-gray-400 text-xs">
            <p>{t("noRecording")}</p>
          </div>
        )}

        {cues.map((cue) => (
          <CueCard key={cue.id} cue={cue} />
        ))}

        {isLoading && cues.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-400">
            <Spinner className="h-3 w-3" />
            {t("analyzing")}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Step 6: `page.tsx` レイアウト変更

### 6.1 import 追加

```typescript
import { useAICues } from "@/hooks/useAICues";
import { AICuesPanel } from "@/components/AICuesPanel";
```

### 6.2 フック呼び出し（HomePage 内、他のフック定義の後に追加）

```typescript
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
```

### 6.3 レイアウト構造の変更

**変更箇所**: `page.tsx` の return 文の最外側コンテナ

**Before** (L708):
```tsx
<div className="mx-auto flex h-[calc(100dvh-56px)] max-w-5xl flex-col px-4 py-2 sm:px-6 lg:px-8">
```

**After**:
```tsx
<div className={cn(
  "mx-auto flex h-[calc(100dvh-56px)] px-4 py-2 sm:px-6 lg:px-8",
  enableAICues && showRecordingUI
    ? "max-w-7xl flex-row gap-4"
    : "max-w-5xl flex-col"
)}>
  {/* Main content wrapper */}
  <div className="flex min-w-0 flex-1 flex-col">
    {/* ... 既存の API Key Warning, Error Display, Recording Controls, Tabs ... */}
  </div>

  {/* AI Cues Side Panel (recording時のみ表示) */}
  {enableAICues && showRecordingUI && (
    <div className="hidden lg:flex flex-none">
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
```

### 6.4 handleStartRecording にリセット追加

```typescript
const handleStartRecording = async () => {
  // ... 既存のリセット処理 ...
  clearCues();  // AI Cues リセット
  // ...
};
```

---

## Step 7: 設定画面

### 7.1 `web/src/app/settings/page.tsx` — AI Cues トグル追加

録音設定セクション（話者分離トグルの下）に追加:

```tsx
{/* AI Cues Setting */}
<div className="flex items-center justify-between">
  <div className="space-y-0.5">
    <label className="text-sm font-medium">
      {t("enableAICues")}
    </label>
    <p className="text-xs text-gray-500">
      {t("enableAICuesDesc")}
    </p>
  </div>
  <label className="relative inline-flex cursor-pointer items-center">
    <input
      type="checkbox"
      checked={settings.enableAICues ?? false}
      onChange={(e) =>
        handleSettingChange({ enableAICues: e.target.checked })
      }
      className="peer sr-only"
    />
    <div className="h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300" />
  </label>
</div>
```

---

## Step 8: i18n メッセージ

### 8.1 `web/messages/ja.json` — AICues セクション追加

```json
{
  "AICues": {
    "title": "AI Cues",
    "concept": "用語解説",
    "bio": "人物情報",
    "suggestion": "提案",
    "waitingForCues": "会話を分析中...",
    "waitingDescription": "発言が溜まるとAIが文脈を分析します",
    "noRecording": "録音を開始するとAI Cuesが表示されます",
    "analyzing": "分析中...",
    "expandPanel": "AI Cuesパネルを展開",
    "collapsePanel": "パネルを折りたたむ",
    "error": "AI Cuesの取得に失敗しました"
  }
}
```

### 8.2 `web/messages/en.json`

```json
{
  "AICues": {
    "title": "AI Cues",
    "concept": "Term",
    "bio": "Bio",
    "suggestion": "Suggestion",
    "waitingForCues": "Analyzing conversation...",
    "waitingDescription": "AI will analyze context as you speak",
    "noRecording": "Start recording to see AI Cues",
    "analyzing": "Analyzing...",
    "expandPanel": "Expand AI Cues panel",
    "collapsePanel": "Collapse panel",
    "error": "Failed to fetch AI Cues"
  }
}
```

### 8.3 `web/messages/es.json`

```json
{
  "AICues": {
    "title": "AI Cues",
    "concept": "Término",
    "bio": "Biografía",
    "suggestion": "Sugerencia",
    "waitingForCues": "Analizando conversación...",
    "waitingDescription": "La IA analizará el contexto mientras hablas",
    "noRecording": "Inicia la grabación para ver AI Cues",
    "analyzing": "Analizando...",
    "expandPanel": "Expandir panel de AI Cues",
    "collapsePanel": "Contraer panel",
    "error": "Error al obtener AI Cues"
  }
}
```

### 8.4 SettingsPage 用メッセージ（各言語に追加）

**ja.json** (SettingsPage セクション内):
```json
"enableAICues": "AI Cues（録音中AI補助）",
"enableAICuesDesc": "録音中にAIが専門用語の解説、人物情報、回答提案を自動表示します"
```

**en.json**:
```json
"enableAICues": "AI Cues (Recording AI Assist)",
"enableAICuesDesc": "AI will automatically show term definitions, bios, and suggestions during recording"
```

**es.json**:
```json
"enableAICues": "AI Cues (Asistencia IA en grabación)",
"enableAICuesDesc": "La IA mostrará automáticamente definiciones, biografías y sugerencias durante la grabación"
```

---

## Step 9: テスト・デバッグ

### 手動テストシナリオ

| # | シナリオ | 手順 | 期待結果 |
|---|---------|------|---------|
| 1 | AI Cues OFF（デフォルト） | 設定で OFF のまま録音開始 | サイドパネル非表示 |
| 2 | AI Cues ON + 録音 | 設定で ON → 録音開始 → 30秒以上話す | サイドパネルが表示、Cueカードが出現 |
| 3 | 専門用語を発話 | "Kubernetes", "CI/CD" 等を含む会話 | Concept カードが生成される |
| 4 | 人名を発話 | "田中さん" "John" 等を含む会話 | Bio カードが生成される |
| 5 | 質問形式 | "〜はどうでしょうか？" | Suggestion カードが生成される |
| 6 | 録音停止 → 再開 | 停止後に再度録音開始 | Cueがリセットされて新しいセッション開始 |
| 7 | パネル折りたたみ | `>` ボタンでパネルを折りたたむ | パネルが縮小、バッジでCue数表示 |
| 8 | API エラー | OpenAI設定なし or ネットワーク切断 | エラーメッセージがパネル内に表示、録音は継続 |
| 9 | モバイル | スマートフォンでアクセス | サイドパネルは非表示（`hidden lg:flex`） |
| 10 | 上限到達 | 長時間録音（20回到達） | カウンター "20/20" 表示、追加呼び出しなし |

---

## ファイル変更一覧（最終）

| ファイル | 変更種別 | 変更量 |
|---------|---------|--------|
| `api/src/functions/cues.ts` | **新規** | ~170行 |
| `api/src/index.ts` | 修正 | +1行 |
| `web/src/types/index.ts` | 修正 | +40行 |
| `web/src/contexts/AuthContext.tsx` | 修正 | +1行 |
| `web/src/hooks/useAICues.ts` | **新規** | ~200行 |
| `web/src/services/cuesApi.ts` | **新規** | ~80行 |
| `web/src/services/index.ts` | 修正 | +1行 |
| `web/src/components/AICuesPanel.tsx` | **新規** | ~220行 |
| `web/src/app/page.tsx` | 修正 | +30行（レイアウト変更 + フック統合） |
| `web/src/app/settings/page.tsx` | 修正 | +20行 |
| `web/messages/ja.json` | 修正 | +15行 |
| `web/messages/en.json` | 修正 | +15行 |
| `web/messages/es.json` | 修正 | +15行 |

**新規ファイル**: 4本
**修正ファイル**: 9本
**総追加行数**: 約810行

---

## ブランチ・PR 命名

```
feat/issue-89-ai-cues
```

PR タイトル:
```
feat: AI Cues — 録音中のリアルタイム文脈補助 (#89)
```

---

## 注意事項

1. **コスト管理**: `AZURE_OPENAI_CUES_DEPLOYMENT_NAME` 環境変数で GPT-4o-mini を指定し、議事録生成の GPT-4 と分離してコストを最小化する
2. **段階的デプロイ**: 設定デフォルトが `false` なので、全ユーザーに影響なし。opt-in 方式
3. **page.tsx の影響最小化**: AI Cues のロジックは `useAICues` と `AICuesPanel` に完全分離。page.tsx への追加は import + フック呼び出し + レイアウト変更の最小限
