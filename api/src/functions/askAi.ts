/**
 * Issue #85: Ask AI — 録音内容への対話型AI質問応答 API エンドポイント
 *
 * SSE (Server-Sent Events) ストリーミングで録音の transcript に対する
 * チャット形式の質問応答を提供する。
 */
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";
import { ReadableStream as WebReadableStream } from "stream/web";
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
  transcript?: {
    segments?: Array<{ speaker?: string; text: string; startTime: number }>;
    fullText: string;
  };
  correctedTranscript?: {
    segments?: Array<{ speaker?: string; text: string; startTime: number }>;
    fullText: string;
  };
  speakerLabels?: Record<string, string>;
}): string {
  // correctedTranscript を優先
  const source = recording.correctedTranscript || recording.transcript;
  if (!source) return "";

  if (source.segments && source.segments.length > 0) {
    return source.segments
      .map((seg) => {
        const label =
          (seg.speaker && recording.speakerLabels?.[seg.speaker]) ||
          seg.speaker ||
          "";
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
function truncateTranscript(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= MAX_TRANSCRIPT_CHARS) {
    return { text, truncated: false };
  }
  // 末尾（最新部分）を優先的に保持
  const truncated =
    "...(前半省略)...\n\n" + text.slice(-MAX_TRANSCRIPT_CHARS);
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
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            success: false,
            error: "question and userId are required",
          }),
        };
      }

      // 1. Recording 取得
      const recording = await getRecording(recordingId!, body.userId);
      if (!recording) {
        return {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            success: false,
            error: "Recording not found",
          }),
        };
      }

      // 2. transcript コンテキスト構築
      const rawTranscript = buildTranscriptContext(recording);
      if (!rawTranscript) {
        return {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            success: false,
            error: "No transcript data available",
          }),
        };
      }

      const { text: transcriptContext } = truncateTranscript(rawTranscript);

      // 3. Azure OpenAI 設定
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            success: false,
            error: "Azure OpenAI is not configured",
          }),
        };
      }

      // 4. メッセージ構築
      const systemContent =
        ASK_AI_SYSTEM_PROMPT +
        "\n\n【文字起こしデータ】\n" +
        transcriptContext;
      const history = limitHistory(body.conversationHistory || []);
      const messages = [
        { role: "system" as const, content: systemContent },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
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
      const readable = new WebReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ content })}\n\n`
                  )
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
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: readable,
      };
    } catch (error) {
      return {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          success: false,
          error: (error as Error).message,
        }),
      };
    }
  },
});
