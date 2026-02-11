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
  // 注意書き（センシティブ情報がある場合）
  caution?: string;
  // 1. 会議情報
  meetingInfo: {
    title: string;
    participants: string[];
    datetime: string;
    purpose: string;
  };
  // 2. アジェンダ一覧
  agenda: string[];
  // 3. 議題別の詳細
  topics: Array<{
    title: string;
    background: string;
    currentStatus: string;
    issues: string;
    discussion: string;
    examples: string;
    nextActions: string;
  }>;
  // 4. 決定事項
  decisions: string[];
  // 5. ToDo / アクションアイテム
  actionItems: Array<{
    id: string;
    task: string;
    assignee: string;
    dueDate: string;
    context: string;
  }>;
  // 6. 重要メモ
  importantNotes: string[];
  // メタ情報
  generatedAt: string;
  // 後方互換性のため残す
  overview?: string;
  keyPoints?: string[];
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

// ─── JSON出力フォーマット（詳細版 Issue #42 v2）───
const JSON_FORMAT = `出力は必ず以下のJSON形式で返してください：
{
  "caution": "【注意書き】センシティブな情報（顧客名、人事評価、内部メモ等）が含まれる場合のみ記載。なければnull",
  
  "meetingInfo": {
    "title": "会議名（不明なら「チーム定例（仮）」等）",
    "participants": ["参加者1", "参加者2"],
    "datetime": "実施日時（不明なら「不明」）",
    "purpose": "会議の目的・背景を1-2文で"
  },
  
  "agenda": [
    "議題1のタイトル",
    "議題2のタイトル",
    "議題3のタイトル"
  ],
  
  "topics": [
    {
      "title": "議題のタイトル",
      "background": "背景・前提（なぜこの議題が上がったか）",
      "currentStatus": "現状共有（事実ベースで）",
      "issues": "課題/懸念（温度感も含める。例：「〇〇さんは強く懸念を示した」）",
      "discussion": "議論の要点（論点→結論/未決の順）",
      "examples": "具体例・発言で出たケース",
      "nextActions": "次アクション候補（決定していなくても候補として明記）"
    }
  ],
  
  "decisions": [
    "決定事項1（決まったことだけ、箇条書き）",
    "決定事項2"
  ],
  
  "actionItems": [
    {
      "id": "1",
      "task": "具体的なToDoの内容",
      "assignee": "担当者名（不明なら「未定」）",
      "dueDate": "期限（YYYY-MM-DD または「未定」「次回定例まで」等）",
      "context": "関連背景・なぜこのタスクが必要か"
    }
  ],
  
  "importantNotes": [
    "運用上の注意事項",
    "共有すべきリスク",
    "ナレッジ化ポイント",
    "今後の再発防止策"
  ]
}

【書き方のルール】
1. 文字起こしの内容に忠実に。推測で事実を増やさない（不明点は「不明」「推定」など明記）
2. 読みやすさのために話題を整理して再構成してよい（会話順のままにしなくて良い）
3. 重要なニュアンス（懸念・温度感・言い回しの意図）は落とさない
4. 固有名詞（人名/顧客名/チーム名/ツール名）や数値（件数/評価/日付/週数）を漏らさず拾う
5. 誰の発言かわかるものは「（〇〇さん）」のように補足
6. 長い会話は「要旨→詳細」の順に圧縮
7. 誤字っぽい箇所は意味が通る範囲で自然な日本語に整える
8. 数字は可能な限り原文に忠実に
9. 必ず有効なJSONで出力`;

// ─── プリセットテンプレートのシステムプロンプト（詳細版 Issue #42 v2）───
const TEMPLATE_PROMPTS: Record<string, string> = {
  general: `あなたは社内向け議事録作成のプロ編集者です。
与えられた文字起こしから、社内共有に耐える"かなり詳細な議事録"を作成してください。

${JSON_FORMAT}

【一般会議の追加指示】
- 複数の議題がある場合は、3〜8項目程度のagendaにまとめる
- 各topicは必ず6項目（background〜nextActions）すべて埋める（該当なしなら「特になし」）
- 発言者が特定できる場合は「（〇〇さん）」と明記
- 議論の経緯（問題提起→意見交換→結論）を追える構成に`,

  regular: `あなたは社内向け議事録作成のプロ編集者です。
与えられた文字起こしから、定例会議の詳細な議事録を作成してください。

${JSON_FORMAT}

【定例会議の追加指示】
- meetingInfo.titleは「〇〇チーム定例」「週次MTG」など具体的に
- agendaに「前回からの進捗確認」「今週の課題共有」「次週の予定」を含める
- topicsの各項目で、前回定例からの変化を意識して記述
- actionItemsは「次回定例まで」「今週中」「今月中」等の時間軸で整理
- importantNotesにKPIや数値目標への言及があれば必ず記録`,

  "one-on-one": `あなたは社内向け議事録作成のプロ編集者です。
与えられた文字起こしから、1on1ミーティングの詳細な議事録を作成してください。

${JSON_FORMAT}

【1on1の追加指示】
- cautionに「1on1の内容。共有範囲に注意」を記載
- topicsのissuesには感情面（モチベーション、不安、悩み）も含める
- 上司からのフィードバック内容は具体的に記録
- キャリアや成長に関する話題は独立したtopicとして記載
- actionItemsは上司/部下の両方のコミットメントを明記
- プライバシーに配慮し、第三者の評価は一般化`,

  sales: `あなたは社内向け議事録作成のプロ編集者です。
与えられた文字起こしから、商談・営業会議の詳細な議事録を作成してください。

${JSON_FORMAT}

【商談の追加指示】
- cautionに顧客名など社外秘情報が含まれる旨を記載
- meetingInfo.purposeに商談フェーズ（初回訪問/提案/クロージング等）を含める
- topicsに以下を必ず含める：
  - 顧客のニーズ・課題
  - 提案内容と顧客反応
  - 競合情報（言及があれば）
  - 価格・条件の議論
  - 導入の障壁
- actionItemsは「見積作成」「提案書修正」「社内調整」「フォローアップ連絡」で分類
- importantNotesに次回アポイント日時、顧客の温度感を記録`,

  "dev-sprint": `あなたは社内向け議事録作成のプロ編集者です。
与えられた文字起こしから、開発ミーティング/スプリントレビューの詳細な議事録を作成してください。

${JSON_FORMAT}

【開発MTGの追加指示】
- meetingInfo.titleに「Sprint XX レビュー」「デイリースクラム」等を含める
- topicsは以下のカテゴリで整理：
  - 完了タスク（チケット番号があれば含める）
  - 進行中タスク（進捗%、残作業）
  - ブロッカー（影響、対応策）
  - 技術的議論（選択肢、決定、トレードオフ）
  - バグ報告（優先度）
- 技術用語、API名、ライブラリ名はそのまま残す
- importantNotesに技術的負債、マイルストーン影響を記録`,

  brainstorm: `あなたは社内向け議事録作成のプロ編集者です。
与えられた文字起こしから、ブレインストーミングセッションの詳細な議事録を作成してください。

${JSON_FORMAT}

【ブレストの追加指示】
- meetingInfo.purposeに「〇〇についてのアイデア出し」と明記
- topicsはアイデアのカテゴリごとに分ける
- 各topicのexamplesに出たアイデアをすべて列挙（却下されたものも含む）
- decisionsには「有望なアイデアTOP3」「検証するアイデア」を記載
- actionItemsは「検証」「リサーチ」「プロトタイプ作成」「関係者確認」で分類
- importantNotesにアイデア評価の基準、融合アイデアを記録`,
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
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

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
        max_tokens: 4000,
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

      // 新フォーマットのレスポンスを構築
      const summary: SummaryResponse = {
        // 注意書き
        caution: parsedSummary.caution || undefined,
        // 1. 会議情報
        meetingInfo: {
          title: parsedSummary.meetingInfo?.title || "会議（タイトル不明）",
          participants: parsedSummary.meetingInfo?.participants || [],
          datetime: parsedSummary.meetingInfo?.datetime || "不明",
          purpose: parsedSummary.meetingInfo?.purpose || "",
        },
        // 2. アジェンダ一覧
        agenda: parsedSummary.agenda || [],
        // 3. 議題別の詳細
        topics: (parsedSummary.topics || []).map((topic: {
          title?: string;
          background?: string;
          currentStatus?: string;
          issues?: string;
          discussion?: string;
          examples?: string;
          nextActions?: string;
        }) => ({
          title: topic.title || "",
          background: topic.background || "",
          currentStatus: topic.currentStatus || "",
          issues: topic.issues || "",
          discussion: topic.discussion || "",
          examples: topic.examples || "",
          nextActions: topic.nextActions || "",
        })),
        // 4. 決定事項
        decisions: parsedSummary.decisions || [],
        // 5. ToDo / アクションアイテム
        actionItems: (parsedSummary.actionItems || []).map(
          (item: { task?: string; assignee?: string; dueDate?: string; context?: string }, index: number) => ({
            id: String(index + 1),
            task: item.task || "",
            assignee: item.assignee || "未定",
            dueDate: item.dueDate || "未定",
            context: item.context || "",
          })
        ),
        // 6. 重要メモ
        importantNotes: parsedSummary.importantNotes || [],
        // メタ情報
        generatedAt: new Date().toISOString(),
        // 後方互換性（旧形式のフィールドも含める）
        overview: parsedSummary.meetingInfo?.purpose || parsedSummary.overview || "",
        keyPoints: parsedSummary.agenda || parsedSummary.keyPoints || [],
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
