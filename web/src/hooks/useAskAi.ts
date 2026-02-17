import { useState, useRef, useEffect } from "react";
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

  const sendMessage = (question: string) => {
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
  };

  const clearHistory = () => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  };

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearHistory,
    stopStreaming,
  };
}
