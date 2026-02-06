import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

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

// Helper function to create JSON response
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
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as SummaryRequest;

      if (!body.transcript) {
        return jsonResponse(
          { success: false, error: "transcript is required" },
          400
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          {
            role: "user",
            content: `以下の文字起こしテキストから議事録を作成してください：\n\n${body.transcript}`,
          },
        ],
        temperature: 0.3,
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

      return jsonResponse<SummaryResponse>({ success: true, data: summary });
    } catch (error) {
      console.error("Summary generation error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
