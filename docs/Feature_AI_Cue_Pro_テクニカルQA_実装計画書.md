# AI Cue Pro — テクニカルQ&A with Citations 実装計画書

## 概要

録音中にAIが技術的質問をリアルタイム検出し、Bing Web Search APIで検索→Azure OpenAI GPT-5-miniで根拠付き回答を自動生成する機能。
既存のAI Cues（Issue #89: concept/bio/suggestion）に4つ目のCueタイプ「answer」を追加する形で実装する。

---

## 前提条件

### 必要なAzureリソース

| リソース | 用途 | 設定 |
|---------|------|------|
| Bing Web Search API v7 | Web検索 | Azure Marketplaceから作成 |
| Azure OpenAI GPT-5-mini | RAG回答生成（申請不要で最高性能） | 既存 or 新規デプロイメント |

### 必要な環境変数（追加）

```env
BING_SEARCH_API_KEY=<Bing Web Search APIキー>
BING_SEARCH_ENDPOINT=https://api.bing.microsoft.com
AZURE_OPENAI_DEEP_ANSWER_DEPLOYMENT_NAME=gpt-5-mini  # 申請不要で最高性能。省略時はAZURE_OPENAI_DEPLOYMENT_NAMEを使用
```

---

## Step 1: 型定義の追加

### 1.1 `web/src/types/index.ts` — Citation & AnswerCue 型定義

既存の AI Cues Types セクション末尾に追加:

```typescript
// ─── AI Cue Pro Types (Deep Answer with Citations) ───

export interface Citation {
  title: string;
  url: string;
  snippet: string;
}

export interface AnswerCue extends BaseCue {
  type: "answer";
  question: string;
  answer: string;           // Markdown形式の詳細回答
  citations: Citation[];
  mode: "tech_support" | "interview" | "general";
}
```

### 1.2 `CueType` と `AICue` ユニオン型の拡張

```typescript
// 変更前:
export type CueType = "concept" | "bio" | "suggestion";
export type AICue = ConceptCue | BioCue | SuggestionCue;

// 変更後:
export type CueType = "concept" | "bio" | "suggestion" | "answer";
export type AICue = ConceptCue | BioCue | SuggestionCue | AnswerCue;
```

### 1.3 `UserSettings` に `aiCueMode` を追加

```typescript
export interface UserSettings {
  // ... 既存フィールド ...
  enableAICues?: boolean;
  aiCueMode?: "tech_support" | "interview" | "general";  // NEW: AI Cue Proモード
  enableRealtimeCorrection?: boolean;
}
```

---

## Step 2: Bing Search APIサービス（バックエンド）

### 2.1 `api/src/services/bingSearch.ts` (新規作成)

```typescript
interface BingWebPage {
  name: string;
  url: string;
  snippet: string;
  dateLastCrawled?: string;
}

interface BingSearchResult {
  webPages?: {
    value: BingWebPage[];
    totalEstimatedMatches: number;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchBing(
  query: string,
  options: {
    count?: number;      // 取得件数 (default: 5)
    market?: string;     // 市場 (default: "ja-JP")
    freshness?: string;  // "Day" | "Week" | "Month" (optional)
  } = {}
): Promise<SearchResult[]> {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  const endpoint = process.env.BING_SEARCH_ENDPOINT || "https://api.bing.microsoft.com";

  if (!apiKey) {
    throw new Error("BING_SEARCH_API_KEY is not configured");
  }

  const { count = 5, market = "ja-JP" } = options;

  const url = new URL(`${endpoint}/v7.0/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("mkt", market);
  url.searchParams.set("responseFilter", "Webpages");
  url.searchParams.set("safeSearch", "Moderate");

  if (options.freshness) {
    url.searchParams.set("freshness", options.freshness);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bing Search API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as BingSearchResult;

  return (data.webPages?.value || []).map((page) => ({
    title: page.name,
    url: page.url,
    snippet: page.snippet,
  }));
}
```

---

## Step 3: Deep Answer APIエンドポイント（バックエンド）

### 3.1 `api/src/functions/deepAnswer.ts` (新規作成)

```typescript
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";
import { searchBing, SearchResult } from "../services/bingSearch";

// ─── 型定義 ───

type AnswerMode = "tech_support" | "interview" | "general";

interface DeepAnswerRequest {
  question: string;
  segments: string[];
  language: string;
  mode: AnswerMode;
}

interface Citation {
  title: string;
  url: string;
  snippet: string;
}

interface DeepAnswerResult {
  answer: string;
  citations: Citation[];
  searchQuery: string;
}

// ─── mode別システムプロンプト ───

const MODE_PROMPTS: Record<AnswerMode, string> = {
  tech_support: `あなたはテクニカルサポートエンジニアの優秀なアシスタントです。
お客様からの技術的質問に対して、以下の方針で回答してください：

1. **正確性**: Web検索結果（後述）の情報を最優先で使用し、正確な回答を提供してください
2. **具体性**: 手順がある場合はステップバイステップで説明してください
3. **引用**: 回答中で参照した検索結果には [1], [2] 等の引用番号を**必ず**付けてください
4. **公式優先**: 公式ドキュメントの情報を優先してください
5. **不確実性の明示**: 検索結果にない情報を推測で補う場合は「※検索結果外の情報」と明記してください
6. **簡潔さ**: 回答は300-500文字程度を目安に、要点を絞ってください`,

  interview: `あなたはエンジニア面接の優秀なアシスタントです。
面接官の技術質問に対して、以下の方針で回答してください：

1. **概念説明**: まず概念を1-2文で正確に定義してください
2. **具体例**: 実際のユースケースや具体例を含めてください
3. **比較**: 類似概念との違い（トレードオフ）を示してください
4. **引用**: 回答中で参照した検索結果には [1], [2] 等の引用番号を**必ず**付けてください
5. **深掘り対策**: 面接官がさらに質問しそうなポイントがあれば軽く触れてください
6. **簡潔さ**: 面接の場で読めるよう、200-400文字程度に収めてください`,

  general: `あなたは会議中のリアルタイムアシスタントです。
質問に対して正確で実用的な回答を提供してください。
回答中で参照した検索結果には [1], [2] 等の引用番号を**必ず**付けてください。
300文字程度で簡潔にまとめてください。`,
};

// ─── ヘルパー関数 ───

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

function getMarket(language: string): string {
  const marketMap: Record<string, string> = {
    "ja-JP": "ja-JP",
    "en-US": "en-US",
    "en-GB": "en-GB",
    "es-ES": "es-ES",
    "es-MX": "es-MX",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    "ko-KR": "ko-KR",
    "fr-FR": "fr-FR",
    "de-DE": "de-DE",
  };
  return marketMap[language] || "en-US";
}

function getLanguageInstruction(language: string): string {
  if (language.startsWith("ja")) return "";
  const langMap: Record<string, string> = {
    "en-US": "English", "en-GB": "English",
    "es-ES": "Spanish", "es-MX": "Spanish",
    "zh-CN": "Chinese", "zh-TW": "Chinese",
    "ko-KR": "Korean", "fr-FR": "French",
    "de-DE": "German",
  };
  const langName = langMap[language] || language;
  return `\n\n重要：回答は${langName}で記述してください。`;
}

// ─── エンドポイント ───

app.http("deepAnswer", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "cues/deep-answer",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as DeepAnswerRequest;

      // バリデーション
      if (!body.question || body.question.trim().length === 0) {
        return jsonResponse(
          { success: false, error: "question is required" },
          400
        );
      }

      const mode = body.mode || "general";
      const language = body.language || "ja-JP";

      // ─── Step 1: Bing Web Search ───
      let searchResults: SearchResult[] = [];
      let searchQuery = body.question;

      try {
        searchResults = await searchBing(searchQuery, {
          count: 5,
          market: getMarket(language),
        });
      } catch (searchError) {
        // Bing検索失敗時はLLM知識のみでフォールバック
        console.warn("Bing search failed, falling back to LLM knowledge:", searchError);
      }

      // ─── Step 2: Azure OpenAI GPT-5-mini (RAG) ───
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_DEEP_ANSWER_DEPLOYMENT_NAME ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      // 検索結果をプロンプトに整形
      const searchContext = searchResults.length > 0
        ? `\n\n## Web検索結果\n${searchResults.map((r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
          ).join("\n\n")}`
        : "\n\n（Web検索結果なし — LLMの知識のみで回答してください）";

      // 会話文脈
      const conversationContext = body.segments.length > 0
        ? `\n\n## 会話の文脈（直近の発言）\n${body.segments.slice(-10).join("\n")}`
        : "";

      const systemPrompt = MODE_PROMPTS[mode] + getLanguageInstruction(language);

      const userMessage = `## 質問\n${body.question}${conversationContext}${searchContext}

上記の検索結果を参考にして、質問に回答してください。
回答中で検索結果を参照する場合は [1], [2] 等の番号で引用してください。`;

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
        max_tokens: 3000,
      });

      const answerContent = response.choices[0]?.message?.content;
      if (!answerContent) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      // Citations を構築（検索結果をそのまま使用）
      const citations: Citation[] = searchResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));

      return jsonResponse<DeepAnswerResult>({
        success: true,
        data: {
          answer: answerContent,
          citations,
          searchQuery,
        },
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

---

## Step 4: フロントエンド APIクライアント拡張

### 4.1 `web/src/services/cuesApi.ts` に追加

```typescript
// ─── Deep Answer API (AI Cue Pro) ───

export interface DeepAnswerInput {
  question: string;
  segments: string[];
  language: string;
  mode: "tech_support" | "interview" | "general";
}

export interface CitationRaw {
  title: string;
  url: string;
  snippet: string;
}

export interface DeepAnswerApiResponse {
  answer: string;
  citations: CitationRaw[];
  searchQuery: string;
}

// CuesApiService クラスに以下のメソッドを追加:

async deepAnswer(
  input: DeepAnswerInput,
  signal?: AbortSignal
): Promise<ApiResponse<DeepAnswerApiResponse>> {
  const url = `${this.baseUrl}/cues/deep-answer`;

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

    return { data: data?.data as DeepAnswerApiResponse };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { error: "REQUEST_ABORTED" };
    }
    return { error: (err as Error).message };
  }
}
```

---

## Step 5: `useDeepAnswer` カスタムフック（フロントエンド）

### 5.1 `web/src/hooks/useDeepAnswer.ts` (新規作成)

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnswerCue, Citation, LiveSegment } from "@/types";
import { cuesApi } from "@/services/cuesApi";

// ─── 設定定数 ───
const MAX_DEEP_ANSWERS_PER_SESSION = 10;
const DEBOUNCE_MS = 3000;
const QUESTION_CHECK_INTERVAL = 3; // 3セグメントごとに質問チェック

// ─── 質問検出パターン ───
const QUESTION_PATTERNS_JA = [
  /(.{5,})(?:とは|って)(?:何|なん)(?:ですか|でしょうか|だ)?[？?]?/,
  /(.{5,})(?:について)(?:教えて|説明して)[くください]*[？?]?/,
  /(.{5,})(?:の違い|の差|の比較)(?:は|を)(?:何|教えて|説明)/,
  /(.{5,})(?:どう(?:やって|すれば|したら))/,
  /(.{5,})(?:の仕組み|のメカニズム|の原理)(?:は|を)/,
  /(.{5,})(?:のベストプラクティス|の推奨)/,
  /(.{5,})(?:エラー|問題|バグ|障害).*(?:原因|解決|対処|対応)/,
];

const QUESTION_PATTERNS_EN = [
  /what (?:is|are|does) (.{5,})[?？]?/i,
  /how (?:to|do|does|can|should) (.{5,})[?？]?/i,
  /(?:can you |could you |please )?explain (.{5,})/i,
  /what(?:'s| is) the difference between (.{5,})/i,
  /why (?:does|is|are|do) (.{5,})[?？]?/i,
  /(?:what|which) (?:is|are) the best (?:practice|way) (.{5,})/i,
];

function detectQuestion(text: string, language: string): string | null {
  const patterns = language.startsWith("ja")
    ? QUESTION_PATTERNS_JA
    : QUESTION_PATTERNS_EN;

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return text; // 質問全体を返す
    }
  }

  // 末尾が ? で終わる場合も質問とみなす
  if (text.trim().endsWith("?") || text.trim().endsWith("？")) {
    return text;
  }

  return null;
}

// ─── Hook Options / Return ───

export interface UseDeepAnswerOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  mode: "tech_support" | "interview" | "general";
  enabled: boolean;
  isRecording: boolean;
}

export interface UseDeepAnswerReturn {
  answers: AnswerCue[];
  isSearching: boolean;
  error: string | null;
  answerCount: number;
  triggerDeepAnswer: (question: string) => void;  // 手動トリガー
  clearAnswers: () => void;
}

// ─── Hook 実装 ───

export function useDeepAnswer({
  segments,
  sourceLanguage,
  mode,
  enabled,
  isRecording,
}: UseDeepAnswerOptions): UseDeepAnswerReturn {
  const [answers, setAnswers] = useState<AnswerCue[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerCount, setAnswerCount] = useState(0);

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const lastCheckedIndexRef = useRef(0);
  const answerCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const answerIdCounterRef = useRef(0);
  const processedQuestionsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Reset on new recording session
  useEffect(() => {
    if (isRecording) {
      setAnswers([]);
      setError(null);
      setAnswerCount(0);
      lastCheckedIndexRef.current = 0;
      answerCountRef.current = 0;
      answerIdCounterRef.current = 0;
      processedQuestionsRef.current = new Set();
    }
  }, [isRecording]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Core: fetch deep answer
  const fetchDeepAnswer = useCallback(
    async (question: string) => {
      if (answerCountRef.current >= MAX_DEEP_ANSWERS_PER_SESSION) return;

      // 重複質問を防止（正規化して比較）
      const normalizedQ = question.trim().toLowerCase();
      if (processedQuestionsRef.current.has(normalizedQ)) return;
      processedQuestionsRef.current.add(normalizedQ);

      // 前のリクエストをキャンセル
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsSearching(true);
      setError(null);
      answerCountRef.current += 1;
      setAnswerCount(answerCountRef.current);

      try {
        const currentSegments = segmentsRef.current;
        const contextTexts = currentSegments.slice(-10).map((s) => s.text);

        const response = await cuesApi.deepAnswer(
          {
            question,
            segments: contextTexts,
            language: sourceLanguage,
            mode,
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

        if (response.data) {
          const newAnswer: AnswerCue = {
            id: `answer-${++answerIdCounterRef.current}`,
            type: "answer",
            timestamp: Date.now(),
            segmentIndex: currentSegments.length - 1,
            question,
            answer: response.data.answer,
            citations: response.data.citations as Citation[],
            mode,
          };

          setAnswers((prev) => [...prev, newAnswer]);
        }
      } catch {
        // Network error
      } finally {
        setIsSearching(false);
        abortControllerRef.current = null;
      }
    },
    [sourceLanguage, mode]
  );

  // 手動トリガー（外部から質問を指定して検索）
  const triggerDeepAnswer = useCallback(
    (question: string) => {
      if (!enabled || !question.trim()) return;
      fetchDeepAnswer(question);
    },
    [enabled, fetchDeepAnswer]
  );

  // 自動質問検出: segments を監視してパターンマッチ
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (answerCountRef.current >= MAX_DEEP_ANSWERS_PER_SESSION) return;

    const newCount = segments.length - lastCheckedIndexRef.current;
    if (newCount < QUESTION_CHECK_INTERVAL) return;

    // 直近のセグメントから質問を検出
    const recentSegments = segments.slice(lastCheckedIndexRef.current);
    lastCheckedIndexRef.current = segments.length;

    for (const seg of recentSegments) {
      const question = detectQuestion(seg.text, sourceLanguage);
      if (question) {
        // デバウンスして質問を処理
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          fetchDeepAnswer(question);
        }, DEBOUNCE_MS);
        break; // 1回の検出で1つだけ処理
      }
    }
  }, [segments.length, enabled, isRecording, sourceLanguage, fetchDeepAnswer]);

  // Abort on recording stop
  useEffect(() => {
    if (!isRecording) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    }
  }, [isRecording]);

  const clearAnswers = useCallback(() => {
    setAnswers([]);
    setError(null);
    setAnswerCount(0);
    lastCheckedIndexRef.current = 0;
    answerCountRef.current = 0;
    processedQuestionsRef.current = new Set();
  }, []);

  return {
    answers,
    isSearching,
    error,
    answerCount,
    triggerDeepAnswer,
    clearAnswers,
  };
}
```

---

## Step 6: `AnswerCard` UIコンポーネント

### 6.1 `web/src/components/AICuesPanel.tsx` に追加

既存の `SuggestionCard` の後に `AnswerCard` を追加:

```tsx
import { ExternalLink, Search, Copy, Check } from "lucide-react";
import { AnswerCue } from "@/types";

const AnswerCard = memo(function AnswerCard({ cue }: { cue: AnswerCue }) {
  const t = useTranslations("AICues");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const handleCopy = () => {
    const text = `${cue.question}\n\n${cue.answer}\n\n引用:\n${cue.citations
      .map((c, i) => `[${i + 1}] ${c.title}: ${c.url}`)
      .join("\n")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const modeLabel = {
    tech_support: "💼 Tech Support",
    interview: "🎤 Interview",
    general: "💡 General",
  }[cue.mode];

  return (
    <div className="rounded-lg border-2 border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-950">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <span className="text-xs font-bold text-purple-800 dark:text-purple-300">
            {t("deepAnswer")}
          </span>
          <span className="rounded-full bg-purple-200 px-2 py-0.5 text-[10px] text-purple-700 dark:bg-purple-800 dark:text-purple-300">
            {modeLabel}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-900"
          title={t("copyAnswer")}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Question */}
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
        ❓ {cue.question}
      </p>

      {/* Answer */}
      <div
        className={cn(
          "text-sm leading-relaxed text-gray-800 dark:text-gray-200",
          !expanded && "line-clamp-4"
        )}
      >
        {cue.answer}
      </div>

      {cue.answer.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-purple-600 hover:underline dark:text-purple-400"
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      )}

      {/* Citations */}
      {cue.citations.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-purple-200 pt-2 dark:border-purple-700">
          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
            📎 {t("citations")} ({cue.citations.length})
          </p>
          {cue.citations.map((citation, index) => (
            <a
              key={index}
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-purple-100 dark:hover:bg-purple-900"
            >
              <span className="mt-0.5 flex-shrink-0 rounded bg-purple-200 px-1 text-[10px] font-bold text-purple-700 dark:bg-purple-800 dark:text-purple-300">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-purple-700 dark:text-purple-400">
                  {citation.title}
                </p>
                <p className="truncate text-gray-400">
                  {new URL(citation.url).hostname}
                </p>
              </div>
              <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
});
```

### 6.2 `CueCard` 関数に `answer` 分岐を追加

```tsx
function CueCard({ cue }: { cue: AICue }) {
  switch (cue.type) {
    case "concept":
      return <ConceptCard cue={cue} />;
    case "bio":
      return <BioCard cue={cue} />;
    case "suggestion":
      return <SuggestionCard cue={cue} />;
    case "answer":
      return <AnswerCard cue={cue} />;
  }
}
```

---

## Step 7: AICuesPanel の拡張

### 7.1 Props に Deep Answer 関連を追加

```typescript
interface AICuesPanelProps {
  cues: AICue[];
  isLoading: boolean;
  error: string | null;
  callCount: number;
  isRecording: boolean;
  enabled: boolean;
  // ─── Deep Answer (AI Cue Pro) ───
  answers?: AnswerCue[];
  isSearching?: boolean;
  searchError?: string | null;
  answerCount?: number;
  onTriggerDeepAnswer?: (question: string) => void;
}
```

### 7.2 手動質問入力UIの追加

AICuesPanelのHeader下部に手動質問入力フィールドを追加:

```tsx
{/* Manual Deep Answer Trigger */}
{onTriggerDeepAnswer && (
  <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-700">
    <div className="flex gap-1.5">
      <input
        type="text"
        placeholder={t("askQuestion")}
        className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs
                   placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200
                   dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            onTriggerDeepAnswer(e.currentTarget.value.trim());
            e.currentTarget.value = "";
          }
        }}
      />
      <button className="rounded-md bg-purple-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-purple-700">
        <Search className="h-3.5 w-3.5" />
      </button>
    </div>
    {isSearching && (
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-purple-600">
        <Spinner className="h-3 w-3" />
        {t("searching")}
      </div>
    )}
  </div>
)}
```

### 7.3 Cue表示リストの統合

```tsx
{/* Combined Cue List: 既存Cues + Deep Answers を時系列で表示 */}
{(() => {
  const allCues: AICue[] = [
    ...cues,
    ...(answers || []),
  ].sort((a, b) => a.timestamp - b.timestamp);

  return allCues.map((cue) => (
    <CueCard key={cue.id} cue={cue} />
  ));
})()}
```

---

## Step 8: `page.tsx` 統合

### 8.1 Hook 呼び出し追加

```typescript
// Issue #89 の AI Cues Hook の後に追加:

// AI Cue Pro: Deep Answer — テクニカルQ&A with Citations
const aiCueMode = settings.aiCueMode ?? "general";
const {
  answers: deepAnswers,
  isSearching: isDeepSearching,
  error: deepAnswerError,
  answerCount: deepAnswerCount,
  triggerDeepAnswer,
  clearAnswers: clearDeepAnswers,
} = useDeepAnswer({
  segments,
  sourceLanguage,
  mode: aiCueMode,
  enabled: enableAICues,  // 既存のAI Cuesと同じトグルで制御
  isRecording: showRecordingUI,
});
```

### 8.2 AICuesPanel に Props を渡す

```tsx
<AICuesPanel
  cues={aiCues}
  isLoading={isCuesLoading}
  error={cuesError}
  callCount={cuesCallCount}
  isRecording={showRecordingUI}
  enabled={enableAICues}
  // ─── Deep Answer Props ───
  answers={deepAnswers}
  isSearching={isDeepSearching}
  searchError={deepAnswerError}
  answerCount={deepAnswerCount}
  onTriggerDeepAnswer={triggerDeepAnswer}
/>
```

### 8.3 handleStartRecording にリセット追加

```typescript
const handleStartRecording = async () => {
  // ... 既存のリセット処理 ...
  clearCues();
  clearDeepAnswers();  // AI Cue Pro リセット
  // ...
};
```

---

## Step 9: 設定画面UI

### 9.1 `web/src/app/settings/page.tsx` に AI Cue Pro モード選択を追加

既存の AI Cues トグルの後に追加:

```tsx
{/* AI Cue Pro Mode Selector */}
{settings.enableAICues && (
  <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950">
    <p className="text-sm font-medium text-purple-800 dark:text-purple-300">
      {t("aiCueMode")}
    </p>
    <p className="mt-0.5 text-xs text-purple-600 dark:text-purple-400">
      {t("aiCueModeDesc")}
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      {(["general", "tech_support", "interview"] as const).map((m) => (
        <button
          key={m}
          onClick={() => handleSettingChange({ aiCueMode: m })}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            settings.aiCueMode === m || (!settings.aiCueMode && m === "general")
              ? "bg-purple-600 text-white"
              : "bg-white text-gray-700 hover:bg-purple-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-purple-900"
          )}
        >
          {t(`aiCueMode_${m}`)}
        </button>
      ))}
    </div>
  </div>
)}
```

---

## Step 10: i18n メッセージ追加

### 10.1 `web/messages/ja.json`

```json
{
  "AICues": {
    "deepAnswer": "AI回答",
    "askQuestion": "質問を入力して検索...",
    "searching": "Web検索中...",
    "copyAnswer": "回答をコピー",
    "citations": "引用元",
    "showMore": "もっと見る",
    "showLess": "閉じる",
    "noCitations": "引用元なし"
  },
  "SettingsPage": {
    "aiCueMode": "AI Cue Pro モード",
    "aiCueModeDesc": "録音中のAIアシスタントの回答スタイルを選択します",
    "aiCueMode_general": "💡 汎用",
    "aiCueMode_tech_support": "💼 テクニカルサポート",
    "aiCueMode_interview": "🎤 面接"
  }
}
```

### 10.2 `web/messages/en.json`

```json
{
  "AICues": {
    "deepAnswer": "AI Answer",
    "askQuestion": "Ask a question...",
    "searching": "Searching the web...",
    "copyAnswer": "Copy answer",
    "citations": "Sources",
    "showMore": "Show more",
    "showLess": "Show less",
    "noCitations": "No sources"
  },
  "SettingsPage": {
    "aiCueMode": "AI Cue Pro Mode",
    "aiCueModeDesc": "Choose the AI assistant's response style during recording",
    "aiCueMode_general": "💡 General",
    "aiCueMode_tech_support": "💼 Tech Support",
    "aiCueMode_interview": "🎤 Interview"
  }
}
```

### 10.3 `web/messages/es.json`

```json
{
  "AICues": {
    "deepAnswer": "Respuesta IA",
    "askQuestion": "Escribe una pregunta...",
    "searching": "Buscando en la web...",
    "copyAnswer": "Copiar respuesta",
    "citations": "Fuentes",
    "showMore": "Ver más",
    "showLess": "Ver menos",
    "noCitations": "Sin fuentes"
  },
  "SettingsPage": {
    "aiCueMode": "Modo AI Cue Pro",
    "aiCueModeDesc": "Elige el estilo de respuesta del asistente IA durante la grabación",
    "aiCueMode_general": "💡 General",
    "aiCueMode_tech_support": "💼 Soporte Técnico",
    "aiCueMode_interview": "🎤 Entrevista"
  }
}
```

---

## Step 11: Azure環境変数設定

### 11.1 Azure Functions App Settings に追加

```bash
# Bing Search API
az functionapp config appsettings set \
  --name func-airecorder-dev \
  --resource-group rg-airecorder \
  --settings \
    BING_SEARCH_API_KEY="<Bing Web Search APIキー>" \
    BING_SEARCH_ENDPOINT="https://api.bing.microsoft.com" \
    AZURE_OPENAI_DEEP_ANSWER_DEPLOYMENT_NAME="gpt-5-mini"
```

### 11.2 Bing Web Search リソースの作成

```bash
# Azure Marketplace から Bing Search v7 リソースを作成
az cognitiveservices account create \
  --name bing-search-airecorder \
  --resource-group rg-airecorder \
  --kind Bing.Search.v7 \
  --sku S1 \
  --location global
```

---

## ファイル変更一覧

| ファイル | 種別 | 変更内容 |
|---------|------|---------|
| `web/src/types/index.ts` | 変更 | Citation, AnswerCue型追加, CueType/AICue拡張, aiCueMode設定追加 |
| `api/src/services/bingSearch.ts` | **新規** | Bing Web Search API v7 クライアント |
| `api/src/functions/deepAnswer.ts` | **新規** | POST /api/cues/deep-answer エンドポイント |
| `web/src/services/cuesApi.ts` | 変更 | deepAnswer() メソッド追加 |
| `web/src/hooks/useDeepAnswer.ts` | **新規** | 質問検出 + Deep Answer取得フック |
| `web/src/components/AICuesPanel.tsx` | 変更 | AnswerCard追加, 手動質問入力UI, Props拡張 |
| `web/src/app/page.tsx` | 変更 | useDeepAnswer Hook呼び出し, AICuesPanel props連携 |
| `web/src/app/settings/page.tsx` | 変更 | AI Cue Pro モード選択UI追加 |
| `web/src/contexts/AuthContext.tsx` | 変更 | aiCueMode デフォルト値追加 |
| `web/messages/ja.json` | 変更 | deepAnswer関連メッセージ追加 |
| `web/messages/en.json` | 変更 | deepAnswer関連メッセージ追加 |
| `web/messages/es.json` | 変更 | deepAnswer関連メッセージ追加 |

---

## 実装の優先順位

1. **Step 1**: 型定義（他全てに依存される基盤）
2. **Step 2**: Bing Search APIサービス（バックエンドの基盤）
3. **Step 3**: Deep Answer APIエンドポイント（バックエンド完成）
4. **Step 4**: フロントエンドAPIクライアント
5. **Step 5**: useDeepAnswer Hook
6. **Step 6-7**: AnswerCard + AICuesPanel拡張
7. **Step 8**: page.tsx統合
8. **Step 9**: 設定画面UI
9. **Step 10**: i18nメッセージ
10. **Step 11**: Azure環境変数設定

---

## UI完成イメージ

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  録音画面                                                              AI Cues │
│                                                                                      │
│  ┌─────────────────────────────────────────┐  ┌──────────────────────────────────┐   │
│  │                                         │  │ ✨ AI Cues              3/20     │   │
│  │  文字起こし表示エリア                     │  │                                  │   │
│  │                                         │  │ ┌────────── 質問入力 ──────────┐  │   │
│  │  話者A: 今回のデプロイで502エラーが      │  │ │ 質問を入力して検索...    🔍 │  │   │
│  │         出ているんですが、原因は何       │  │ └────────────────────────────────┘  │   │
│  │         でしょうか？                     │  │                                  │   │
│  │                                         │  │ ┌── 💡 Concept ──────────────┐  │   │
│  │  話者B: ちょっと確認しますね...          │  │ │ 502 Bad Gateway             │  │   │
│  │                                         │  │ │ サーバーがゲートウェイとして  │  │   │
│  │                                         │  │ │ 動作中に無効な応答を受信...   │  │   │
│  │                                         │  │ └──────────────────────────────┘  │   │
│  │                                         │  │                                  │   │
│  │                                         │  │ ┌── 🔍 AI回答 ───── 💼 ──────┐  │   │
│  │                                         │  │ │ ❓ 502エラーの原因は何ですか │  │   │
│  │                                         │  │ │                              │  │   │
│  │                                         │  │ │ 502 Bad Gatewayエラーは、    │  │   │
│  │                                         │  │ │ 主に以下の原因で発生します:  │  │   │
│  │                                         │  │ │                              │  │   │
│  │                                         │  │ │ 1. アップストリームサーバー   │  │   │
│  │                                         │  │ │    の応答タイムアウト [1]    │  │   │
│  │                                         │  │ │ 2. ロードバランサーの設定    │  │   │
│  │                                         │  │ │    不備 [2]                  │  │   │
│  │                                         │  │ │ 3. アプリケーションの        │  │   │
│  │                                         │  │ │    クラッシュ/再起動中 [1]   │  │   │
│  │                                         │  │ │                              │  │   │
│  │                                         │  │ │ 📎 引用元 (3)               │  │   │
│  │                                         │  │ │ [1] Azure App Service の     │  │   │
│  │                                         │  │ │     トラブルシューティング    │  │   │
│  │                                         │  │ │     learn.microsoft.com  🔗  │  │   │
│  │                                         │  │ │ [2] HTTP 502エラー - MDN     │  │   │
│  │                                         │  │ │     developer.mozilla.org 🔗 │  │   │
│  │                                         │  │ │ [3] NGINX 502解決ガイド      │  │   │
│  │                                         │  │ │     nginx.org            🔗  │  │   │
│  │                                         │  │ └──────────────────── 📋 ──────┘  │   │
│  └─────────────────────────────────────────┘  └──────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
