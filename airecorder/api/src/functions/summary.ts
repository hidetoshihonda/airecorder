import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";
import {
  requireAuth,
  handleAuthError,
  AuthenticationError,
  AuthorizationError,
} from "../utils/auth";

interface SummaryRequest {
  transcript: string;
  language?: string;
}

interface SummaryResponse {
  overview: string;
  keyPoints: string[];
  actionItems: Array<{
    id: string;
    description: string;
    assignee?: string;
    dueDate?: string;
  }>;
  generatedAt: string;
}

// CORS設定
const ALLOWED_ORIGINS = [
  "https://proud-rock-06bba6200.2.azurestaticapps.net",
  "http://localhost:3000",
  "http://localhost:4280"
];

function getCorsHeaders(request: HttpRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ms-client-principal",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}

// Helper function to create JSON response
function jsonResponse<T>(
  data: { success: boolean; data?: T; error?: string },
  status: number = 200,
  corsHeaders?: Record<string, string>
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(corsHeaders || {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }),
    },
    body: JSON.stringify(data),
  };
}

const SUMMARY_SYSTEM_PROMPT = `あなたは会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、以下の形式で構造化された議事録を作成してください。

出力は必ず以下のJSON形式で返してください：
{
  "overview": "会議の概要（2-3文で簡潔に）",
  "keyPoints": ["重要ポイント1", "重要ポイント2", ...],
  "actionItems": [
    {
      "id": "1",
      "description": "アクションアイテムの説明",
      "assignee": "担当者名（わかる場合）",
      "dueDate": "期限（わかる場合、YYYY-MM-DD形式）"
    }
  ]
}

注意事項：
- 概要は会議の主要な目的と結論を含めてください
- 重要ポイントは3-7個程度に絞ってください
- アクションアイテムは具体的なタスクを抽出してください
- 担当者や期限が明確でない場合はnullにしてください
- 必ず有効なJSONを返してください`;

app.http("generateSummary", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "summary/generate",
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders };
    }

    try {
      // 認証必須（コスト保護）
      const principal = requireAuth(request);
      context.log(`generateSummary: userId=${principal.userId}`);

      const body = (await request.json()) as SummaryRequest;

      if (!body.transcript) {
        return jsonResponse(
          { success: false, error: "transcript is required" },
          400,
          corsHeaders
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500,
          corsHeaders
        );
      }

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      // 言語に応じたプロンプト調整
      let systemPrompt = SUMMARY_SYSTEM_PROMPT;
      let userPrompt = `以下の文字起こしテキストから議事録を作成してください：\n\n${body.transcript}`;

      if (body.language && body.language !== 'ja') {
        const languageNames: Record<string, string> = {
          'en': 'English',
          'es': 'Spanish',
          'zh': 'Chinese',
          'ko': 'Korean',
        };
        const langName = languageNames[body.language] || body.language;
        userPrompt = `Please create meeting minutes in ${langName} from the following transcript:\n\n${body.transcript}`;
      }

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500,
          corsHeaders
        );
      }

      const parsedSummary = JSON.parse(content);

      const summary: SummaryResponse = {
        overview: parsedSummary.overview || "",
        keyPoints: parsedSummary.keyPoints || [],
        actionItems: (parsedSummary.actionItems || []).map(
          (item: { description?: string; assignee?: string; dueDate?: string }, index: number) => ({
            id: String(index + 1),
            description: item.description || "",
            assignee: item.assignee || undefined,
            dueDate: item.dueDate || undefined,
          })
        ),
        generatedAt: new Date().toISOString(),
      };

      return jsonResponse<SummaryResponse>(
        { success: true, data: summary },
        200,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      context.error("Summary generation error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500,
        corsHeaders
      );
    }
  },
});
