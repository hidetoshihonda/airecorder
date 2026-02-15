import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

interface CuesRequest {
  segments: string[]; // 直近の確定セグメントテキスト
  language: string; // ソース言語 (例: "ja-JP")
  context?: string; // オプション: 会議テーマ等
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
    "en-US": "English",
    "en-GB": "English",
    "es-ES": "Spanish",
    "es-MX": "Spanish",
    "zh-CN": "Chinese",
    "zh-TW": "Chinese",
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
