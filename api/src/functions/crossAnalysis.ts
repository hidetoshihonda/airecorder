/**
 * Issue #90: クロスミーティング集計分析 API エンドポイント
 *
 * 複数の録音を横断的に分析し、共通テーマ・アクションアイテム進捗・
 * 決定事項の変遷・トレンド分析を提供する。
 */
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";
import { getMultipleRecordings } from "../services/recordingService";
import {
  CrossAnalysisRequest,
  CrossAnalysisResponse,
  Recording,
  ApiResponse,
} from "../models";

// --- constants ---
const MAX_RECORDINGS = 20;
const MIN_RECORDINGS = 2;
const MAX_CROSS_ANALYSIS_CHARS = 100_000;
const MAX_PER_RECORDING_CHARS = 8_000;

// --- helpers ---
function jsonResponse<T>(
  data: ApiResponse<T>,
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

/** 各録音から分析用テキストを構築する */
function buildRecordingContext(recording: Recording): string {
  // 要約がある場合は要約を使用（トークン節約）
  if (recording.summary) {
    const s = recording.summary;
    const parts: string[] = [];

    if (s.meetingInfo) {
      parts.push(`会議名: ${s.meetingInfo.title}`);
      parts.push(`目的: ${s.meetingInfo.purpose}`);
    }

    if (s.topics && s.topics.length > 0) {
      parts.push("【議題】");
      for (const topic of s.topics) {
        parts.push(`- ${topic.title}: ${topic.content || ""}`);
      }
    }

    if (s.decisions && s.decisions.length > 0) {
      parts.push("【決定事項】");
      for (const d of s.decisions) {
        parts.push(`- ${d}`);
      }
    }

    if (s.actionItems && s.actionItems.length > 0) {
      parts.push("【アクションアイテム】");
      for (const item of s.actionItems) {
        if (typeof item === "string") {
          parts.push(`- ${item}`);
        } else {
          parts.push(`- ${item.task || item.id}: 担当=${item.assignee || "未定"}, 期限=${item.dueDate || "未定"}`);
        }
      }
    }

    if (s.nextSteps && s.nextSteps.length > 0) {
      parts.push("【次のステップ】");
      for (const ns of s.nextSteps) {
        parts.push(`- ${ns}`);
      }
    }

    return parts.join("\n");
  }

  // 要約がない場合は fullText を使用（切り詰め）
  const source = recording.correctedTranscript || recording.transcript;
  if (!source?.fullText) return "";

  const text = source.fullText;
  if (text.length <= MAX_PER_RECORDING_CHARS) return text;

  // 末尾（最新部分）を優先的に保持
  return "...(前半省略)...\n" + text.slice(-MAX_PER_RECORDING_CHARS);
}

/** 録音日を整形 */
function formatRecordingDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** 全録音テキストの合計文字数を調整 */
function truncateContexts(
  contexts: { recording: Recording; text: string }[]
): { recording: Recording; text: string }[] {
  let totalChars = contexts.reduce((sum, c) => sum + c.text.length, 0);

  if (totalChars <= MAX_CROSS_ANALYSIS_CHARS) return contexts;

  // summary 未使用の録音（fullText 直接使用）から段階的に切り詰め
  const sorted = [...contexts].sort((a, b) => b.text.length - a.text.length);
  for (const ctx of sorted) {
    if (totalChars <= MAX_CROSS_ANALYSIS_CHARS) break;
    const excess = totalChars - MAX_CROSS_ANALYSIS_CHARS;
    const maxCut = Math.min(excess, ctx.text.length - 500);
    if (maxCut > 0) {
      ctx.text = "...(前半省略)...\n" + ctx.text.slice(maxCut);
      totalChars -= maxCut;
    }
  }

  return sorted;
}

// --- GPT prompt ---
const CROSS_ANALYSIS_SYSTEM_PROMPT = `あなたは複数の会議を横断的に分析する専門家です。
以下に複数の会議の記録が時系列順に提供されます。
これらを統合的に分析し、以下の観点で構造化された結果をJSON形式で出力してください。

【分析観点】
1. overallSummary: 全会議を通した総括（200〜400文字）。主な論点の流れと全体的な進捗状況を記述
2. commonThemes: 複数の会議で繰り返し議論されたテーマ。各テーマにどの会議で言及されたか(mentionedIn)と出現回数(frequency)を記載
3. actionItemTracking: 会議間でのアクションアイテムの進捗追跡。同一タスクが複数会議で言及されている場合は1つにまとめ、statusを判定する
   - status: "new"(初回言及のみ), "in-progress"(進行中), "completed"(完了報告あり), "stalled"(停滞/進展なし), "dropped"(中止/言及なし)
   - history: 各会議でそのタスクについてどのような更新があったかを時系列で記録
4. decisionEvolution: 同一トピックに関する決定事項が会議間でどう変化したか。方針転換や追加決定を追跡
5. trends: 議論の傾向分析
   - topicFrequency: トピック名→言及回数のマップ
   - recurringIssues: 複数回繰り返し発生している未解決の課題

【出力JSON形式】
{
  "overallSummary": "...",
  "commonThemes": [
    { "theme": "テーマ名", "description": "説明", "mentionedIn": ["会議名1", "会議名2"], "frequency": 3 }
  ],
  "actionItemTracking": [
    {
      "task": "タスク内容",
      "assignee": "担当者",
      "firstMentioned": "会議名 (日付)",
      "lastMentioned": "会議名 (日付)",
      "status": "in-progress",
      "history": [
        { "recordingTitle": "会議名", "date": "2026/01/15", "update": "更新内容" }
      ]
    }
  ],
  "decisionEvolution": [
    {
      "topic": "トピック名",
      "decisions": [
        { "recordingTitle": "会議名", "date": "2026/01/15", "decision": "決定内容" }
      ]
    }
  ],
  "trends": {
    "topicFrequency": { "トピックA": 5, "トピックB": 3 },
    "recurringIssues": ["繰り返し発生する課題1", "課題2"]
  }
}

【ルール】
1. 文字起こし/要約の内容に忠実に。推測で事実を増やさない
2. 固有名詞・数値・日時は正確に引用する
3. 参加者名は元データのラベルをそのまま使用する（推測で実名を付けない）
4. 必ず有効なJSONで出力する
5. 各会議の情報を漏れなく横断的に分析する`;

// --- Azure Function ---
app.http("crossAnalysis", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/cross-analysis",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as CrossAnalysisRequest;

      // 1. バリデーション
      if (!body.userId) {
        return jsonResponse(
          { success: false, error: "userId is required" },
          400
        );
      }
      if (
        !body.recordingIds ||
        !Array.isArray(body.recordingIds) ||
        body.recordingIds.length < MIN_RECORDINGS
      ) {
        return jsonResponse(
          { success: false, error: `At least ${MIN_RECORDINGS} recordings are required` },
          400
        );
      }
      if (body.recordingIds.length > MAX_RECORDINGS) {
        return jsonResponse(
          { success: false, error: `Maximum ${MAX_RECORDINGS} recordings can be selected` },
          400
        );
      }

      // 2. 複数録音の取得
      const recordings = await getMultipleRecordings(
        body.recordingIds,
        body.userId
      );

      if (recordings.length < MIN_RECORDINGS) {
        return jsonResponse(
          { success: false, error: "Not enough valid recordings found" },
          404
        );
      }

      // 3. 各録音のコンテキスト構築
      let contexts = recordings.map((r) => ({
        recording: r,
        text: buildRecordingContext(r),
      }));

      // transcript も summary もない録音を除外
      contexts = contexts.filter((c) => c.text.length > 0);

      if (contexts.length < MIN_RECORDINGS) {
        return jsonResponse(
          {
            success: false,
            error:
              "Not enough recordings with transcript or summary data. At least 2 recordings with content are required.",
          },
          400
        );
      }

      // 4. トークン管理: 合計文字数を制限
      contexts = truncateContexts(contexts);

      // 5. ユーザーメッセージ組み立て
      const meetingBlocks = contexts
        .map((c, i) => {
          const date = formatRecordingDate(c.recording.createdAt);
          const hasSummary = !!c.recording.summary;
          return [
            `=== 会議 ${i + 1}: 「${c.recording.title}」(${date}, ${c.recording.duration}秒, ${hasSummary ? "要約あり" : "文字起こし"}) ===`,
            c.text,
          ].join("\n");
        })
        .join("\n\n");

      const userMessage = `以下は${contexts.length}件の会議の記録です（時系列順）。\nこれらを横断的に分析してください。\n\n${meetingBlocks}`;

      // 6. Azure OpenAI 呼び出し
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

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const completion = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: CROSS_ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 16000,
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content;

      // デバッグログ
      const usage = completion.usage;
      console.log(
        `[CrossAnalysis] recordings=${contexts.length}, model=${deploymentName}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}, total_tokens=${usage?.total_tokens}`
      );

      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      const parsed = JSON.parse(content);

      // 7. レスポンス構築
      const result: CrossAnalysisResponse = {
        overallSummary: parsed.overallSummary || "",
        commonThemes: (parsed.commonThemes || []).map(
          (t: { theme?: string; description?: string; mentionedIn?: string[]; frequency?: number }) => ({
            theme: t.theme || "",
            description: t.description || "",
            mentionedIn: t.mentionedIn || [],
            frequency: t.frequency || 0,
          })
        ),
        actionItemTracking: (parsed.actionItemTracking || []).map(
          (a: {
            task?: string;
            assignee?: string;
            firstMentioned?: string;
            lastMentioned?: string;
            status?: string;
            history?: Array<{ recordingTitle?: string; date?: string; update?: string }>;
          }) => ({
            task: a.task || "",
            assignee: a.assignee || "未定",
            firstMentioned: a.firstMentioned || "",
            lastMentioned: a.lastMentioned || "",
            status: a.status || "new",
            history: (a.history || []).map((h) => ({
              recordingTitle: h.recordingTitle || "",
              date: h.date || "",
              update: h.update || "",
            })),
          })
        ),
        decisionEvolution: (parsed.decisionEvolution || []).map(
          (d: {
            topic?: string;
            decisions?: Array<{ recordingTitle?: string; date?: string; decision?: string }>;
          }) => ({
            topic: d.topic || "",
            decisions: (d.decisions || []).map((dec) => ({
              recordingTitle: dec.recordingTitle || "",
              date: dec.date || "",
              decision: dec.decision || "",
            })),
          })
        ),
        trends: {
          topicFrequency: parsed.trends?.topicFrequency || {},
          sentimentTrend: parsed.trends?.sentimentTrend || undefined,
          recurringIssues: parsed.trends?.recurringIssues || [],
        },
        analyzedRecordings: contexts.map((c) => ({
          id: c.recording.id,
          title: c.recording.title,
          date: formatRecordingDate(c.recording.createdAt),
          duration: c.recording.duration,
        })),
        generatedAt: new Date().toISOString(),
      };

      return jsonResponse<CrossAnalysisResponse>({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("[CrossAnalysis] Error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
