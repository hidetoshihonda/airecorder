import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";
import { searchBing, SearchResult } from "../services/bingSearch";

// ─── 型定義 ───

type AnswerMode = "tech_support" | "interview" | "general";

interface DeepAnswerRequest {
  question: string;
  segments: string[];
  language: string;
  mode: AnswerMode;
}

interface Citation {
  title: string;
  url: string;
  snippet: string;
}

interface DeepAnswerResult {
  answer: string;
  citations: Citation[];
  searchQuery: string;
}

// ─── mode別システムプロンプト ───

const MODE_PROMPTS: Record<AnswerMode, string> = {
  tech_support: `あなたはテクニカルサポートエンジニアの優秀なアシスタントです。
お客様からの技術的質問に対して、以下の方針で回答してください：

1. **正確性**: Web検索結果（後述）の情報を最優先で使用し、正確な回答を提供してください
2. **具体性**: 手順がある場合はステップバイステップで説明してください
3. **引用**: 回答中で参照した検索結果には [1], [2] 等の引用番号を**必ず**付けてください
4. **公式優先**: 公式ドキュメントの情報を優先してください
5. **不確実性の明示**: 検索結果にない情報を推測で補う場合は「※検索結果外の情報」と明記してください
6. **簡潔さ**: 回答は300-500文字程度を目安に、要点を絞ってください`,

  interview: `あなたはエンジニア面接の優秀なアシスタントです。
面接官の技術質問に対して、以下の方針で回答してください：

1. **概念説明**: まず概念を1-2文で正確に定義してください
2. **具体例**: 実際のユースケースや具体例を含めてください
3. **比較**: 類似概念との違い（トレードオフ）を示してください
4. **引用**: 回答中で参照した検索結果には [1], [2] 等の引用番号を**必ず**付けてください
5. **深掘り対策**: 面接官がさらに質問しそうなポイントがあれば軽く触れてください
6. **簡潔さ**: 面接の場で読めるよう、200-400文字程度に収めてください`,

  general: `あなたは会議中のリアルタイムアシスタントです。
質問に対して正確で実用的な回答を提供してください。
回答中で参照した検索結果には [1], [2] 等の引用番号を**必ず**付けてください。
300文字程度で簡潔にまとめてください。`,
};

// ─── ヘルパー関数 ───

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

function getMarket(language: string): string {
  const marketMap: Record<string, string> = {
    "ja-JP": "ja-JP",
    "en-US": "en-US",
    "en-GB": "en-GB",
    "es-ES": "es-ES",
    "es-MX": "es-MX",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    "ko-KR": "ko-KR",
    "fr-FR": "fr-FR",
    "de-DE": "de-DE",
  };
  return marketMap[language] || "en-US";
}

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
  };
  const langName = langMap[language] || language;
  return `\n\n重要：回答は${langName}で記述してください。`;
}

// ─── エンドポイント ───

app.http("deepAnswer", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "cues/deep-answer",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as DeepAnswerRequest;

      // バリデーション
      if (!body.question || body.question.trim().length === 0) {
        return jsonResponse(
          { success: false, error: "question is required" },
          400
        );
      }

      const mode = body.mode || "general";
      const language = body.language || "ja-JP";

      // ─── Step 1: Bing Web Search ───
      let searchResults: SearchResult[] = [];
      const searchQuery = body.question;

      try {
        searchResults = await searchBing(searchQuery, {
          count: 5,
          market: getMarket(language),
        });
      } catch (searchError) {
        // Bing検索失敗時はLLM知識のみでフォールバック
        console.warn(
          "Bing search failed, falling back to LLM knowledge:",
          searchError
        );
      }

      // ─── Step 2: Azure OpenAI GPT-5-mini (RAG) ───
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_DEEP_ANSWER_DEPLOYMENT_NAME ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      // 検索結果をプロンプトに整形
      const searchContext =
        searchResults.length > 0
          ? `\n\n## Web検索結果\n${searchResults
              .map(
                (r, i) =>
                  `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
              )
              .join("\n\n")}`
          : "\n\n（Web検索結果なし — LLMの知識のみで回答してください）";

      // 会話文脈
      const conversationContext =
        body.segments.length > 0
          ? `\n\n## 会話の文脈（直近の発言）\n${body.segments.slice(-10).join("\n")}`
          : "";

      const systemPrompt =
        MODE_PROMPTS[mode] + getLanguageInstruction(language);

      const userMessage = `## 質問\n${body.question}${conversationContext}${searchContext}

上記の検索結果を参考にして、質問に回答してください。
回答中で検索結果を参照する場合は [1], [2] 等の番号で引用してください。`;

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
        max_tokens: 3000,
      });

      const answerContent = response.choices[0]?.message?.content;
      if (!answerContent) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      // Citations を構築（検索結果をそのまま使用）
      const citations: Citation[] = searchResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));

      return jsonResponse<DeepAnswerResult>({
        success: true,
        data: {
          answer: answerContent,
          citations,
          searchQuery,
        },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
