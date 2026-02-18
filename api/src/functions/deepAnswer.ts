import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

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

// Responses API レスポンス型
interface ResponsesAnnotation {
  type: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface ResponsesContent {
  type: string;
  text?: string;
  annotations?: ResponsesAnnotation[];
}

interface ResponsesOutput {
  type: string;
  content?: ResponsesContent[];
}

interface ResponsesApiResult {
  output?: ResponsesOutput[];
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

      // ─── Azure OpenAI 設定 ───
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

      // ─── Responses API with web_search_preview ───
      const systemPrompt =
        MODE_PROMPTS[mode] + getLanguageInstruction(language);

      // 会話文脈
      const segments = body.segments || [];
      const conversationContext =
        segments.length > 0
          ? `\n\n## 会話の文脈（直近の発言）\n${segments.slice(-10).join("\n")}`
          : "";

      const userMessage = `## 質問\n${body.question}${conversationContext}

上記の質問に対して、Web検索結果を参考にして回答してください。
回答中で検索結果を参照する場合は [1], [2] 等の番号で引用してください。`;

      const apiVersion = "2025-03-01-preview";
      const responsesUrl = `${endpoint.replace(/\/$/, "")}/openai/responses?api-version=${apiVersion}`;

      const responsesBody = {
        model: deploymentName,
        input: userMessage,
        instructions: systemPrompt,
        tools: [
          {
            type: "web_search_preview" as const,
            search_context_size: "medium",
          },
        ],
        max_output_tokens: 3000,
      };

      const responsesResp = await fetch(responsesUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(responsesBody),
      });

      if (!responsesResp.ok) {
        const errText = await responsesResp.text();
        // Responses API が利用不可の場合、Chat Completions にフォールバック
        if (responsesResp.status === 404 || responsesResp.status === 400) {
          return await fallbackChatCompletions(
            endpoint,
            apiKey,
            deploymentName,
            systemPrompt,
            userMessage
          );
        }
        return jsonResponse(
          {
            success: false,
            error: `Azure OpenAI Responses API error ${responsesResp.status}: ${errText}`,
          },
          500
        );
      }

      const responsesData = (await responsesResp.json()) as ResponsesApiResult;

      // output からメッセージと引用を抽出
      const messageOutput = responsesData.output?.find(
        (o) => o.type === "message"
      );
      const textContent = messageOutput?.content?.find(
        (c) => c.type === "output_text"
      );

      const answerContent = textContent?.text;
      if (!answerContent) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      // URL引用アノテーションからCitationsを構築
      const annotations = textContent?.annotations || [];
      const seenUrls = new Set<string>();
      const citations: Citation[] = [];
      for (const ann of annotations) {
        if (ann.type === "url_citation" && ann.url && !seenUrls.has(ann.url)) {
          seenUrls.add(ann.url);
          citations.push({
            title: ann.title || new URL(ann.url).hostname,
            url: ann.url,
            snippet: "",
          });
        }
      }

      return jsonResponse<DeepAnswerResult>({
        success: true,
        data: {
          answer: answerContent,
          citations,
          searchQuery: body.question,
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

// ─── フォールバック: Chat Completions API (Web検索なし) ───

async function fallbackChatCompletions(
  endpoint: string,
  apiKey: string,
  deploymentName: string,
  systemPrompt: string,
  userMessage: string
): Promise<HttpResponseInit> {
  const { AzureOpenAI } = await import("openai");
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
        content:
          userMessage +
          "\n\n（Web検索は利用できません。LLMの知識のみで回答してください）",
      },
    ],
    max_completion_tokens: 3000,
  });

  const answerContent = response.choices[0]?.message?.content;
  if (!answerContent) {
    return jsonResponse(
      { success: false, error: "No response from OpenAI" },
      500
    );
  }

  return jsonResponse<DeepAnswerResult>({
    success: true,
    data: {
      answer: answerContent,
      citations: [],
      searchQuery: "",
    },
  });
}
