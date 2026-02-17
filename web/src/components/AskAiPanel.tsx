"use client";

import { useState, useRef, useEffect, memo } from "react";
import {
  Send,
  Trash2,
  StopCircle,
  MessageCircle,
  Sparkles,
  User,
  Bot,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div
      className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-blue-100 text-blue-600"
            : "bg-purple-100 text-purple-600"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
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
              <h3 className="text-lg font-medium text-gray-700">
                {t("welcomeTitle")}
              </h3>
              <p className="text-sm text-gray-500 max-w-md">
                {t("welcomeDescription")}
              </p>
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
                isStreaming={
                  isStreaming &&
                  idx === messages.length - 1 &&
                  msg.role === "assistant"
                }
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
