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
  templateId?: string;
  customPrompt?: string;
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

// ─── JSON出力フォーマット ───
const JSON_FORMAT = `出力は必ず以下のJSON形式で返してください：
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
- 担当者や期限が明確でない場合はnullにしてください
- 必ず有効なJSONを返してください`;

// ─── プリセットテンプレートのシステムプロンプト ───
const TEMPLATE_PROMPTS: Record<string, string> = {
  general: `あなたは会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、構造化された議事録を作成してください。

${JSON_FORMAT}

注意事項：
- 概要は会議の主要な目的と結論を含めてください
- 重要ポイントは3-7個程度に絞ってください
- アクションアイテムは具体的なタスクを抽出してください`,

  regular: `あなたは定例会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、定例会議に特化した議事録を作成してください。

${JSON_FORMAT}

定例会議に特化した注意事項：
- 概要には前回からの進捗と今回の主要議題を含めてください
- 重要ポイントには各報告事項の要点を含めてください
- アクションアイテムには次回までのタスク、期限を明確にしてください
- 決定事項と持ち越し事項を区別してください`,

  "one-on-one": `あなたは1on1ミーティングの議事録を作成する専門家です。
与えられた文字起こしテキストから、1on1に特化した議事録を作成してください。

${JSON_FORMAT}

1on1に特化した注意事項：
- 概要にはミーティングの主なテーマ（業務/キャリア/モチベーション等）を含めてください
- 重要ポイントには相談内容、フィードバック、合意事項を含めてください
- アクションアイテムには両者のコミットメントを明確にしてください
- 個人的な悩みや感情面の話題も適切に要約してください
- プライバシーに配慮し、センシティブな内容は一般化してください`,

  sales: `あなたは商談・営業会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、商談に特化した議事録を作成してください。

${JSON_FORMAT}

商談に特化した注意事項：
- 概要には顧客名・案件名（推測可能な場合）、商談フェーズ、主な結論を含めてください
- 重要ポイントには顧客の課題・ニーズ、提案内容、価格交渉、競合情報を含めてください
- アクションアイテムには提案書作成、見積もり提出、次回アポイント等を含めてください
- 顧客の温度感や懸念点を明示してください`,

  "dev-sprint": `あなたは開発チームのミーティング議事録を作成する専門家です。
与えられた文字起こしテキストから、スプリントレビュー/開発MTGに特化した議事録を作成してください。

${JSON_FORMAT}

開発MTGに特化した注意事項：
- 概要にはスプリントの成果、主要な技術的議論を含めてください
- 重要ポイントには完了タスク、技術的課題、設計判断、バグ報告を含めてください
- アクションアイテムには具体的な開発タスク（チケット番号があれば含める）、担当者を明確にしてください
- 技術的な用語はそのまま残してください
- ブロッカーや依存関係を明示してください`,

  brainstorm: `あなたはブレインストーミングセッションの議事録を作成する専門家です。
与えられた文字起こしテキストから、ブレスト結果を整理した議事録を作成してください。

${JSON_FORMAT}

ブレストに特化した注意事項：
- 概要にはブレストのテーマと到達した方向性を含めてください
- 重要ポイントには出されたアイデアをカテゴリ別にグルーピングして含めてください
- 各アイデアの実現可能性や発展性のコメントがあれば含めてください
- アクションアイテムには検証すべきアイデア、深堀りすべきテーマを含めてください
- 否定されたアイデアも記録に残してください（理由とともに）`,
};

/** テンプレート ID またはカスタムプロンプトからシステムプロンプトを解決 */
function resolveSystemPrompt(templateId?: string, customPrompt?: string): string {
  if (customPrompt) return customPrompt;
  if (templateId && TEMPLATE_PROMPTS[templateId]) return TEMPLATE_PROMPTS[templateId];
  return TEMPLATE_PROMPTS["general"];
}

/** 言語指示を返す（日本語以外の場合） */
function getLanguageInstruction(language?: string): string {
  if (!language || language === "ja-JP" || language === "ja") return "";
  const langMap: Record<string, string> = {
    "en-US": "English", "en-GB": "English", en: "English",
    "es-ES": "Spanish", "es-MX": "Spanish", es: "Spanish",
    "zh-CN": "Chinese", "zh-TW": "Chinese", zh: "Chinese",
    "ko-KR": "Korean", ko: "Korean",
    "fr-FR": "French", fr: "French",
    "de-DE": "German", de: "German",
  };
  const langName = langMap[language] || language;
  return `\n\n重要：出力は${langName}で記述してください。`;
}

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

      const systemPrompt = resolveSystemPrompt(body.templateId, body.customPrompt) + getLanguageInstruction(body.language);

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
