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
  type: "question";
  // question — 質問検知＋回答
  question: string;
  answer: string;
  confidence: "high" | "medium";
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

const CUES_SYSTEM_PROMPT = `あなたは会議中のリアルタイム質問検知アシスタントです。
与えられた会話テキスト（直近の発言セグメント）を分析し、会話の中で出てきた「質問」や「疑問」「確認したいこと」を検知してください。
検知した質問に対して、あなたの知識を使って具体的で実用的な回答を提供してください。

## 検知する質問の例
- 「〇〇って何ですか？」「〇〇とは？」
- 「〇〇はどうなっていますか？」
- 「〇〇の違いは？」「〇〇と△△の差は？」
- 「〇〇はどうすればいいですか？」
- 「なぜ〇〇なのですか？」
- 「〇〇はいくらですか？」「〇〇の期限は？」
- 疑問形でなくても「〇〇について調べたい」「〇〇が分からない」等の暗黙の疑問

## 出力形式（JSON）
{
  "cues": [
    {
      "type": "question",
      "question": "検知した質問（原文に忠実に、ただし簡潔に整理）",
      "answer": "具体的で実用的な回答（3-5文程度。数値・事実を含めて具体的に）",
      "confidence": "high または medium"
    }
  ]
}

## ルール
1. 会話中に質問・疑問がない場合は空配列 [] を返す（無理に生成しない）
2. 挨拶や雑談の質問（「元気ですか？」等）は無視する
3. 回答はあなたの知識に基づき、具体的な事実・数値・手順を含めて実用的に書く
4. 確信度が高い回答は "high"、推測を含む場合は "medium" とする
5. 最大3件まで（重要度順）
6. 必ず有効なJSONで出力
7. 回答は150文字以内を目安に簡潔にまとめる`;

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
