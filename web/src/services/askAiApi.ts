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
        } catch {
          /* ignore */
        }
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
            } catch {
              /* skip malformed SSE data */
            }
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
