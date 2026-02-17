# Issue #85: Ask AI 録音内容への対話型AI質問応答 — 実装計画書

## 概要

録音の文字起こしデータに対してチャット形式で質問し、AIが文脈を踏まえて回答するSSEストリーミング対話機能を実装する。

---

## 1. API エンドポイント実装

### 新規ファイル: `api/src/functions/askAi.ts`

**ルート**: `POST /api/recordings/{recordingId}/ask`

```typescript
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";
import { getRecording } from "../services/recordingService";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AskAiRequest {
  question: string;
  conversationHistory?: ChatMessage[];
  userId: string;
}

const ASK_AI_SYSTEM_PROMPT = `あなたは会議の録音内容について質問に答える優秀なアシスタントです。
以下の文字起こしデータに基づいて、正確かつ簡潔に回答してください。

【回答ルール】
1. 文字起こしに記載されていない情報は推測しない。不明な点は「文字起こしからは確認できません」と明記する
2. 話者情報がある場合は「[話者名]が述べた」のように出典を明示する
3. 回答は見やすいフォーマット（箇条書き、番号付きリスト、表など）を適切に使用する
4. 長い回答は見出し付きで構造化する
5. 時系列が重要な場合は時間順で整理する
6. 数値・固有名詞・日時は正確に引用する
7. 回答は日本語で行う（質問が他言語の場合はその言語で回答）`;

// transcript を話者ラベル付きで構築
function buildTranscriptContext(recording: {
  transcript?: { segments?: Array<{ speaker?: string; text: string; startTime: number }>; fullText: string };
  correctedTranscript?: { segments?: Array<{ speaker?: string; text: string; startTime: number }>; fullText: string };
  speakerLabels?: Record<string, string>;
}): string {
  // correctedTranscript を優先
  const source = recording.correctedTranscript || recording.transcript;
  if (!source) return "";

  if (source.segments && source.segments.length > 0) {
    return source.segments
      .map((seg) => {
        const label = (seg.speaker && recording.speakerLabels?.[seg.speaker]) || seg.speaker || "";
        const timeMin = Math.floor(seg.startTime / 60);
        const timeSec = Math.floor(seg.startTime % 60);
        const timestamp = `${timeMin}:${timeSec.toString().padStart(2, "0")}`;
        return label
          ? `[${timestamp}] [${label}] ${seg.text}`
          : `[${timestamp}] ${seg.text}`;
      })
      .join("\n");
  }

  return source.fullText;
}

// 長大な transcript を切り詰め
const MAX_TRANSCRIPT_CHARS = 80000;
function truncateTranscript(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TRANSCRIPT_CHARS) {
    return { text, truncated: false };
  }
  // 末尾（最新部分）を優先的に保持
  const truncated = "...(前半省略)...\n\n" + text.slice(-MAX_TRANSCRIPT_CHARS);
  return { text: truncated, truncated: true };
}

// 会話履歴を最大件数に制限
const MAX_HISTORY_MESSAGES = 20; // 10ターン分
function limitHistory(history: ChatMessage[]): ChatMessage[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  return history.slice(-MAX_HISTORY_MESSAGES);
}

app.http("askAi", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{recordingId}/ask",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      };
    }

    try {
      const recordingId = request.params.recordingId;
      const body = (await request.json()) as AskAiRequest;

      if (!body.question || !body.userId) {
        return {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ success: false, error: "question and userId are required" }),
        };
      }

      // 1. Recording 取得
      const recording = await getRecording(recordingId!, body.userId);
      if (!recording) {
        return {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ success: false, error: "Recording not found" }),
        };
      }

      // 2. transcript コンテキスト構築
      const rawTranscript = buildTranscriptContext(recording);
      if (!rawTranscript) {
        return {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ success: false, error: "No transcript data available" }),
        };
      }

      const { text: transcriptContext } = truncateTranscript(rawTranscript);

      // 3. Azure OpenAI 設定
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ success: false, error: "Azure OpenAI is not configured" }),
        };
      }

      // 4. メッセージ構築
      const systemContent = ASK_AI_SYSTEM_PROMPT + "\n\n【文字起こしデータ】\n" + transcriptContext;
      const history = limitHistory(body.conversationHistory || []);
      const messages = [
        { role: "system" as const, content: systemContent },
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: body.question },
      ];

      // 5. ストリーミング生成
      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const stream = await client.chat.completions.create({
        model: deploymentName,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        stream: true,
      });

      // 6. SSE レスポンス構築
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                );
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`
              )
            );
            controller.close();
          }
        },
      });

      return {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: readable,
      };
    } catch (error) {
      return {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ success: false, error: (error as Error).message }),
      };
    }
  },
});
```

**ポイント**:
- `correctedTranscript` を優先使用（#70 との連携）
- `speakerLabels` を transcript に反映（#140 との連携）
- transcript の切り詰め（80,000 文字制限）
- 会話履歴は直近 20 メッセージに制限
- SSE ストリーミングで `ReadableStream` を返す
- `data: [DONE]` で完了を通知

---

## 2. フロントエンド API サービス

### 新規ファイル: `web/src/services/askAiApi.ts`

```typescript
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskAiInput {
  question: string;
  conversationHistory?: ChatMessage[];
  userId: string;
}

class AskAiApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * SSE ストリーミングで Ask AI を呼び出す
   * @param recordingId 録音ID
   * @param input リクエストボディ
   * @param onChunk テキストチャンク受信コールバック
   * @param onDone 完了コールバック
   * @param onError エラーコールバック
   * @param signal AbortSignal (キャンセル用)
   */
  async askStreaming(
    recordingId: string,
    input: AskAiInput,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (error: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const url = `${this.baseUrl}/recordings/${recordingId}/ask`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `HTTP error ${response.status}`;
        try {
          const data = JSON.parse(text);
          errorMsg = data.error || errorMsg;
        } catch { /* ignore */ }
        onError(errorMsg);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 最後の不完全な行を保持

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              onDone();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                onChunk(parsed.content);
              }
              if (parsed.error) {
                onError(parsed.error);
                return;
              }
            } catch { /* skip malformed SSE data */ }
          }
        }
      }

      // ストリーム終了後に [DONE] を受け取っていない場合
      onDone();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // ユーザーキャンセル — エラーにしない
        onDone();
        return;
      }
      onError((err as Error).message || "Network error");
    }
  }
}

export const askAiApi = new AskAiApiService();
```

---

## 3. カスタムフック

### 新規ファイル: `web/src/hooks/useAskAi.ts`

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import { askAiApi, ChatMessage } from "@/services/askAiApi";
import { useAuth } from "@/contexts/AuthContext";

export interface DisplayMessage extends ChatMessage {
  id: string;
  timestamp: number;
}

interface UseAskAiOptions {
  recordingId: string;
}

interface UseAskAiReturn {
  messages: DisplayMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (question: string) => void;
  clearHistory: () => void;
  stopStreaming: () => void;
}

export function useAskAi({ recordingId }: UseAskAiOptions): UseAskAiReturn {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef("");
  const { user } = useAuth();

  // unmount 時にストリームをキャンセル
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isStreaming || !user?.id) return;

      setError(null);
      setIsStreaming(true);
      streamingContentRef.current = "";

      // ユーザーメッセージを追加
      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      // ストリーミング中のアシスタントメッセージ（プレースホルダー）
      const assistantMsgId = `assistant-${Date.now()}`;
      const assistantMsg: DisplayMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // 会話履歴を構築（ストリーミング中のメッセージは除く）
      const conversationHistory: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // AbortController 作成
      abortControllerRef.current = new AbortController();

      askAiApi.askStreaming(
        recordingId,
        {
          question: trimmed,
          conversationHistory,
          userId: user.id,
        },
        // onChunk
        (text) => {
          streamingContentRef.current += text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: streamingContentRef.current }
                : m
            )
          );
        },
        // onDone
        () => {
          setIsStreaming(false);
          abortControllerRef.current = null;
        },
        // onError
        (errMsg) => {
          setIsStreaming(false);
          setError(errMsg);
          abortControllerRef.current = null;
          // エラー時は空のアシスタントメッセージを削除
          if (!streamingContentRef.current) {
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
          }
        },
        abortControllerRef.current.signal
      );
    },
    [isStreaming, messages, recordingId, user?.id]
  );

  const clearHistory = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearHistory,
    stopStreaming,
  };
}
```

---

## 4. UI コンポーネント

### 新規ファイル: `web/src/components/AskAiPanel.tsx`

```typescript
"use client";

import { useState, useRef, useEffect, memo } from "react";
import { Send, Trash2, StopCircle, MessageCircle, Sparkles, User, Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useAskAi, DisplayMessage } from "@/hooks/useAskAi";

interface AskAiPanelProps {
  recordingId: string;
  hasTranscript: boolean;
}

// --- 個別メッセージコンポーネント ---
const ChatBubble = memo(function ChatBubble({
  message,
  isStreaming,
}: {
  message: DisplayMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-800"
        )}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        {!isUser && isStreaming && !message.content && (
          <div className="flex items-center gap-1 py-1">
            <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
            <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
            <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
          </div>
        )}
        {!isUser && isStreaming && message.content && (
          <span className="inline-block h-4 w-1 animate-pulse bg-gray-400 ml-0.5" />
        )}
      </div>
    </div>
  );
});

// --- 質問例 ---
const SUGGESTED_QUESTIONS_KEYS = [
  "suggestDecisions",
  "suggestActionItems",
  "suggestTopicSummary",
  "suggestParticipants",
  "suggestKeyPoints",
] as const;

// --- メインコンポーネント ---
export function AskAiPanel({ recordingId, hasTranscript }: AskAiPanelProps) {
  const t = useTranslations("AskAI");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearHistory,
    stopStreaming,
  } = useAskAi({ recordingId });

  // 新メッセージ時に自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput("");
    inputRef.current?.focus();
  };

  const handleSuggestedQuestion = (questionKey: string) => {
    const question = t(questionKey);
    sendMessage(question);
  };

  if (!hasTranscript) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <MessageCircle className="h-12 w-12 text-gray-300 mb-4" />
        <p>{t("noTranscriptAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[60vh]">
      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full space-y-6">
            <div className="text-center space-y-2">
              <Sparkles className="mx-auto h-10 w-10 text-purple-400" />
              <h3 className="text-lg font-medium text-gray-700">{t("welcomeTitle")}</h3>
              <p className="text-sm text-gray-500 max-w-md">{t("welcomeDescription")}</p>
            </div>
            {/* 質問例 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED_QUESTIONS_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => handleSuggestedQuestion(key)}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-left text-sm text-gray-700 hover:border-purple-300 hover:bg-purple-50 transition-colors"
                >
                  <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
                  <span>{t(key)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && idx === messages.length - 1 && msg.role === "assistant"}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 入力エリア */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              disabled={isStreaming}
              className="shrink-0 text-gray-400 hover:text-red-500"
              title={t("clearHistory")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={t("inputPlaceholder")}
            disabled={isStreaming}
            className="flex-1"
          />
          {isStreaming ? (
            <Button
              variant="outline"
              size="sm"
              onClick={stopStreaming}
              className="shrink-0"
            >
              <StopCircle className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## 5. recording/page.tsx 統合

### 5.1 import 追加

```typescript
// 既存の import に追加
import { MessageCircle } from "lucide-react";
import { AskAiPanel } from "@/components/AskAiPanel";
```

### 5.2 Tabs 変更

**変更前**: `grid-cols-3`
```tsx
<TabsList className="grid w-full grid-cols-3">
```

**変更後**: `grid-cols-4`
```tsx
<TabsList className="grid w-full grid-cols-4">
```

### 5.3 新タブトリガー追加

Summary の TabsTrigger の後に追加:

```tsx
<TabsTrigger value="askAi" className="gap-2">
  <MessageCircle className="h-4 w-4" />
  {t("askAiTab")}
</TabsTrigger>
```

### 5.4 新タブコンテンツ追加

Summary TabsContent の閉じタグ後に追加:

```tsx
{/* Ask AI Tab */}
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
```

---

## 6. hooks/index.ts 変更

```typescript
// 追加
export { useAskAi } from "./useAskAi";
```

---

## 7. services/index.ts 変更

```typescript
// 追加
export { askAiApi } from "./askAiApi";
```

---

## 8. i18n メッセージ追加

### ja.json — RecordingDetail セクションに追加

```json
"askAiTab": "Ask AI"
```

### ja.json — 新規 AskAI セクション

```json
"AskAI": {
  "welcomeTitle": "録音内容について質問する",
  "welcomeDescription": "この録音の文字起こし内容について、AIに質問できます。決定事項やアクションアイテムの抽出、特定の話題の要約など、何でも聞いてください。",
  "noTranscriptAvailable": "文字起こしデータがないため、質問できません",
  "inputPlaceholder": "録音内容について質問...",
  "clearHistory": "会話をクリア",
  "suggestDecisions": "決定事項をまとめて",
  "suggestActionItems": "アクションアイテムを一覧にして",
  "suggestTopicSummary": "話し合った内容を要約して",
  "suggestParticipants": "参加者と発言内容を整理して",
  "suggestKeyPoints": "重要なポイントを教えて"
}
```

### en.json — RecordingDetail セクションに追加

```json
"askAiTab": "Ask AI"
```

### en.json — 新規 AskAI セクション

```json
"AskAI": {
  "welcomeTitle": "Ask about this recording",
  "welcomeDescription": "Ask AI questions about the transcript of this recording. You can extract decisions, action items, summarize specific topics, and more.",
  "noTranscriptAvailable": "No transcript data available for questions",
  "inputPlaceholder": "Ask about the recording...",
  "clearHistory": "Clear conversation",
  "suggestDecisions": "Summarize the decisions made",
  "suggestActionItems": "List all action items",
  "suggestTopicSummary": "Summarize the discussion topics",
  "suggestParticipants": "List participants and their contributions",
  "suggestKeyPoints": "What are the key points?"
}
```

### es.json — RecordingDetail セクションに追加

```json
"askAiTab": "Ask AI"
```

### es.json — 新規 AskAI セクション

```json
"AskAI": {
  "welcomeTitle": "Pregunta sobre esta grabación",
  "welcomeDescription": "Haz preguntas a la IA sobre la transcripción de esta grabación. Puedes extraer decisiones, elementos de acción, resumir temas específicos y más.",
  "noTranscriptAvailable": "No hay datos de transcripción disponibles para preguntas",
  "inputPlaceholder": "Pregunta sobre la grabación...",
  "clearHistory": "Borrar conversación",
  "suggestDecisions": "Resume las decisiones tomadas",
  "suggestActionItems": "Lista todos los elementos de acción",
  "suggestTopicSummary": "Resume los temas discutidos",
  "suggestParticipants": "Lista los participantes y sus contribuciones",
  "suggestKeyPoints": "¿Cuáles son los puntos clave?"
}
```

---

## 9. API getRecording 参照確認

`api/src/services/recordingService.ts` の `getRecording` は既に公開されており、`askAi.ts` から直接 import 可能。追加の変更は不要。

---

## 10. 実装チェックリスト

| # | 作業 | ファイル | 種別 |
|---|------|---------|------|
| 1 | SSE ストリーミング API エンドポイント | `api/src/functions/askAi.ts` | 新規 |
| 2 | SSE クライアントサービス | `web/src/services/askAiApi.ts` | 新規 |
| 3 | 会話管理フック | `web/src/hooks/useAskAi.ts` | 新規 |
| 4 | チャット UI コンポーネント | `web/src/components/AskAiPanel.tsx` | 新規 |
| 5 | recording/page.tsx 統合 | `web/src/app/recording/page.tsx` | 修正 |
| 6 | hooks/index.ts export 追加 | `web/src/hooks/index.ts` | 修正 |
| 7 | services/index.ts export 追加 | `web/src/services/index.ts` | 修正 |
| 8 | ja.json i18n 追加 | `web/messages/ja.json` | 修正 |
| 9 | en.json i18n 追加 | `web/messages/en.json` | 修正 |
| 10 | es.json i18n 追加 | `web/messages/es.json` | 修正 |
| 11 | API ビルド確認 | `cd api && npx tsc --noEmit` | 検証 |
| 12 | Web ビルド確認 | `cd web && npm run build` | 検証 |

---

## 11. 補足: Azure Functions での SSE 注意点

Azure Functions v4 (Node.js) では `HttpResponseInit.body` に `ReadableStream` を渡すことで HTTP ストリーミングが可能。以下の点に注意:

1. **Content-Type**: `text/event-stream` を設定
2. **Connection**: `keep-alive` を設定
3. **バッファリング**: Azure の場合、内部プロキシがバッファリングする可能性がある。`X-Accel-Buffering: no` ヘッダーの追加を検討。
4. **タイムアウト**: デフォルト 230 秒。長い応答でもタイムアウトしない。
5. **フォールバック**: SSE が問題を起こす場合、非ストリーミング（通常の JSON レスポンス）にフォールバック可能。

---

## 12. 将来の拡張（Phase 2 以降）

- マークダウンレンダリング（react-markdown）
- メッセージのコピーボタン
- 会話履歴の CosmosDB 永続化
- 複数録音横断質問（#90 連携）
- レスポンス中の transcript 該当箇所ハイライト
- トークン使用量の表示
