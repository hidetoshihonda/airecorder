/**
 * Issue #88: マインドマップ自動生成 API エンドポイント
 *
 * 文字起こしテキストから Markmap 形式の Markdown を GPT で生成する。
 */
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

interface MindmapRequest {
  transcript: string;
  language?: string;
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

const MINDMAP_SYSTEM_PROMPT = `あなたは会議内容を構造化するエキスパートです。
与えられた文字起こしから、マインドマップ用の Markdown を生成してください。

【出力形式】
- Markdown の見出し構造（#, ##, ###, ####）のみを使用してください
- ルートノード（#）は会議名またはテーマ（1つのみ）
- 第2レベル（##）は主要な議題・トピック（3-8個程度）
- 第3レベル（###）はサブトピック・詳細
- 第4レベル（####）は具体的な決定事項・アクションアイテム
- 各ノードは簡潔に（1行、20文字以内を推奨）
- 箇条書き（-）でノードの補足情報を追加可能
- 全ての重要な議題を漏れなく含める
- 決定事項は「✅」、アクションアイテムは「📌」、課題は「⚠️」の絵文字でマーク

【重要ルール】
- 純粋な Markdown のみを出力（コードブロックで囲まない）
- 余計な説明文は付けない
- ノードは短く簡潔に

【出力例】
# プロジェクト進捗会議
## 開発進捗
### フロントエンド
- React 移行 80% 完了
#### ✅ 来週中にβ版リリース
### バックエンド
- API v2 設計完了
#### 📌 負荷テスト実施（田中）
## 課題・リスク
### ⚠️ パフォーマンス問題
- ページ読み込み3秒超過
#### 📌 CDN 導入検討
## 次回アクション
### 来週火曜 14:00 再MTG`;

function getLanguageInstruction(language?: string): string {
  if (!language || language === "ja-JP" || language === "ja") return "";
  const langMap: Record<string, string> = {
    "en-US": "English",
    "en-GB": "English",
    en: "English",
    "es-ES": "Spanish",
    "es-MX": "Spanish",
    es: "Spanish",
    "zh-CN": "Chinese",
    "ko-KR": "Korean",
    "fr-FR": "French",
    "de-DE": "German",
  };
  const langName = langMap[language] || language;
  return `\n\n重要：出力は${langName}で記述してください。`;
}

const MAX_TRANSCRIPT_CHARS = 60000;

app.http("generateMindmap", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "mindmap/generate",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as MindmapRequest;

      if (!body.transcript) {
        return jsonResponse(
          { success: false, error: "transcript is required" },
          400
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      const systemPrompt =
        MINDMAP_SYSTEM_PROMPT + getLanguageInstruction(body.language);

      // transcript 切り詰め
      let transcript = body.transcript;
      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        transcript =
          "...(前半省略)...\n\n" + transcript.slice(-MAX_TRANSCRIPT_CHARS);
      }

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
            content: `以下は会議の文字起こしです。この内容からマインドマップ用の Markdown を生成してください。\n\n---\n${transcript}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      // コードブロックで囲まれている場合は除去
      let markdown = content.trim();
      if (markdown.startsWith("```markdown")) {
        markdown = markdown.slice("```markdown".length);
      } else if (markdown.startsWith("```")) {
        markdown = markdown.slice(3);
      }
      if (markdown.endsWith("```")) {
        markdown = markdown.slice(0, -3);
      }
      markdown = markdown.trim();

      const usage = response.usage;
      console.log(
        `[Mindmap] model=${deploymentName}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}, output_length=${markdown.length}`
      );

      return jsonResponse<{ markdown: string }>({
        success: true,
        data: { markdown },
      });
    } catch (error) {
      console.error("Mindmap generation error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
