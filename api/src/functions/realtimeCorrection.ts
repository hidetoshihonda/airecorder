/**
 * Issue #126: リアルタイムAI補正 API エンドポイント
 *
 * 録音中にバッチ（5セグメントごと）で文字起こしテキストを LLM 補正する。
 * AI Cues (cues.ts) と同様のパターン。
 */
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

interface RealtimeCorrectionRequest {
  segments: Array<{ id: string; text: string }>;
  language: string;
  phraseList?: string[];
}

interface CorrectionItem {
  id: string;
  original: string;
  corrected: string;
}

interface CorrectionResponse {
  corrections: CorrectionItem[];
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

const REALTIME_CORRECTION_PROMPT = `あなたは音声認識結果をリアルタイムで校正する専門家です。
与えられた複数の発言セグメントを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」、「以上」→「異常」）
- 明らかな聞き間違い
- 不自然な単語の区切り
- 固有名詞の誤認識（文脈から推測可能な場合）

【修正してはいけないもの】
- 話者の意図や内容を変える
- 文体や口調（話し言葉のまま）
- 文法的に正しい表現への書き換え
- 修正不要なセグメント

JSON形式で出力:
{
  "corrections": [
    { "id": "セグメントID", "original": "原文", "corrected": "補正後テキスト" }
  ]
}

修正が不要な場合は "corrections": [] を返してください。
修正があるセグメントのみ出力してください。`;

function getLanguageInstruction(language: string): string {
  if (language.startsWith("ja")) return "";
  return "\n\n重要：出力は元のテキストと同じ言語で記述してください。";
}

app.http("realtimeCorrection", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "correction/realtime",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as RealtimeCorrectionRequest;

      if (!body.segments || body.segments.length === 0) {
        return jsonResponse(
          { success: false, error: "segments array is required" },
          400
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_CORRECTION_DEPLOYMENT_NAME ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      // フレーズリスト追加（精度向上）
      const phraseHint =
        body.phraseList && body.phraseList.length > 0
          ? `\n\n【参考: よく使われる固有名詞・専門用語】\n${body.phraseList.join("、")}`
          : "";

      const systemPrompt =
        REALTIME_CORRECTION_PROMPT +
        getLanguageInstruction(body.language) +
        phraseHint;

      const segmentsText = body.segments
        .map((s) => `[${s.id}] ${s.text}`)
        .join("\n");

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `以下の発言セグメントを確認してください:\n\n${segmentsText}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      const parsed = JSON.parse(content) as CorrectionResponse;

      return jsonResponse<CorrectionResponse>({
        success: true,
        data: { corrections: parsed.corrections || [] },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
