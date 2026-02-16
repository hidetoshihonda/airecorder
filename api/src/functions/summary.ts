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
  // 2. アジェンダ一覧（= 議題・論点）
  agenda: string[];
  // 3. 主要な会話内容（時系列、論点ごと）
  topics: Array<{
    title: string;
    content: string;
    // 後方互換（旧形式）
    background?: string;
    currentStatus?: string;
    issues?: string;
    discussion?: string;
    examples?: string;
    nextActions?: string;
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
  // 6. 質疑応答
  qaItems: Array<{
    question: string;
    answer: string;
  }>;
  // 7. 次回に向けて
  nextSteps: string[];
  // メタ情報
  generatedAt: string;
  // 後方互換性のため残す
  importantNotes?: string[];
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

// ─── JSON出力フォーマット（Issue #136 v3：8セクション構成）───
const JSON_FORMAT = `出力は必ず以下のJSON形式で返してください：
{
  "caution": "センシティブ情報がある場合のみ記載。なければnull",

  "meetingInfo": {
    "title": "会議名（不明なら『チーム定例（仮）』等）",
    "participants": ["田中（PM）", "佐藤（エンジニア）", "鈴木（お客様側）"],
    "datetime": "実施日時（不明なら『不明』）",
    "purpose": "会議の目的・背景を1-2文で"
  },

  "agenda": [
    "議題・論点1",
    "議題・論点2"
  ],

  "topics": [
    {
      "title": "論点の小見出し",
      "content": "時系列で議論の流れを記述する。発言者がわかる場合は（〇〇さん）と補足。背景→議論→結論/未決の順で書く。曖昧な箇所は（要確認）を付ける。重要な数値は**太字**にする。"
    }
  ],

  "decisions": [
    "決定事項1（決まったことだけ）",
    "決定事項2"
  ],

  "actionItems": [
    {
      "id": "1",
      "task": "具体的なToDoの内容",
      "assignee": "担当者名（不明なら『未定』）",
      "dueDate": "期限（YYYY-MM-DD または『未定』『次回定例まで』等）",
      "context": "関連背景"
    }
  ],

  "qaItems": [
    {
      "question": "会議中に出た質問",
      "answer": "それに対する回答（未回答なら『未回答・持ち帰り』）"
    }
  ],

  "nextSteps": [
    "次回の予定・アジェンダ案",
    "フォローアップ事項",
    "今後のスケジュール"
  ]
}

【書き方のルール】
1. 文字起こしの内容に忠実に。推測で事実を増やさない（不明点は「不明」「（要確認）」など明記）
2. 時系列の流れが追えるように整理しつつ、話題の転換点を明確にする
3. 重要なニュアンス（懸念・温度感・言い回しの意図）は落とさない
4. 固有名詞（人名/顧客名/チーム名/ツール名）や数値は漏らさず拾う
5. 誰の発言かわかるものは「（〇〇さん）」のように補足
6. 参加者の役割が推測できる場合は participants に役割を付記（例: "田中（PM）"）
7. 重要な数値・期間・時間帯は **太字** にする
8. 参加者名が曖昧な場合は「（発話ログ上の呼称：◯◯）」のように書く
9. 根拠のない推測は書かない
10. 必ず有効なJSONで出力`;

// ─── プリセットテンプレートのシステムプロンプト（詳細版 Issue #42 v2）───
const TEMPLATE_PROMPTS: Record<string, string> = {
  summary: `あなたは文字起こしを簡潔に要約する専門家です。
与えられた文字起こしテキストから、短く分かりやすい要約を作成してください。

出力は必ず以下のJSON形式で返してください：
{
  "overview": "内容の要約（100-200字程度）。何について話されたかを簡潔にまとめる",
  "keyPoints": [
    "重要なポイント1",
    "重要なポイント2",
    "重要なポイント3"
  ],
  "actionItems": []
}

要約作成の指示：
- 詳細な議事録ではなく、短い要約を作成
- keyPointsは3-5個程度に絞る
- 箇条書きは簡潔に（厐20-50字程度）
- actionItemsは明確なものがあれば記載、なければ空配列
- 必ず有効なJSONで出力`,

  general: `あなたは最強の議事録作成者です。
以下の会議ログ（発話の羅列/文字起こし/メモ）から、「詳細な議事録（ドラフト）」を作成してください。

# 出力要件（必須）
- 事実ベースで、会議で合意した内容・未決事項・宿題を明確に分ける
- 時系列の流れが追えるように整理しつつ、最後に決定事項/アクションをまとめる
- 聞き取りづらい・曖昧な箇所は、勝手に断定せず「（要確認）」として残す
- 固有名詞（人名/製品名/組織名/数値/日時）は、ログにある表現を尊重し、曖昧なら「◯◯（要確認）」とする
- 可能な範囲でQ&A形式を抽出する（質問→回答）
- 文体はビジネス向け、箇条書きを多用して読みやすく

# フォーマット（この見出し順で必ず出す）
1. 会議情報（会議名/開催形式/目的）
2. 参加者（お客様側/Microsoft側 など役割別に分類）
3. 議題・論点（箇条書き）
4. 主要な会話内容（時系列。論点ごとに小見出しを付ける）
5. 決定事項（Decision）
6. 宿題・アクションアイテム（Action Items：担当/期限が不明なら「未定」）
7. 質疑応答（主なQ&A）
8. 次回に向けた進め方（Next Steps）

# 追加ルール
- 重要な数値・期間・時間帯・制限（例：2GB、3週間、◯時〜◯時）は太字にする
- 参加者名が曖昧な場合は「（発話ログ上の呼称：◯◯）」のように書く
- 過不足があってもよいので、判断根拠のない推測は書かない

${JSON_FORMAT}`,

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
        max_tokens: 8000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;

      // デバッグログ: LLM出力の構造・トークン使用量を監視（Issue #136）
      if (content) {
        const usage = response.usage;
        console.log(`[Summary] template=${body.templateId || 'default'}, model=${deploymentName}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}, total_tokens=${usage?.total_tokens}, output_length=${content.length}`);
        try {
          const preview = JSON.parse(content);
          const topicCount = preview.topics?.length || 0;
          const hasContent = preview.topics?.some((t: { content?: string }) => t.content) || false;
          const qaCount = preview.qaItems?.length || 0;
          console.log(`[Summary] topics=${topicCount}, hasContent=${hasContent}, qaItems=${qaCount}, hasNextSteps=${!!preview.nextSteps?.length}`);
        } catch {
          console.log(`[Summary] WARNING: Failed to preview parsed structure`);
        }
      }

      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      const parsedSummary = JSON.parse(content);

      // 新フォーマットのレスポンスを構築（Issue #136 v3）
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
        // 3. 主要な会話内容（新形式: content / 旧形式: background等 両対応）
        topics: (parsedSummary.topics || []).map((topic: {
          title?: string;
          content?: string;
          background?: string;
          currentStatus?: string;
          issues?: string;
          discussion?: string;
          examples?: string;
          nextActions?: string;
        }) => {
          // 旧形式フィールドを content に統合（LLMが旧形式で出力した場合のフォールバック）
          const legacyContent = [
            topic.background && `【背景】${topic.background}`,
            topic.currentStatus && `【現状】${topic.currentStatus}`,
            topic.issues && `【課題】${topic.issues}`,
            topic.discussion && `【議論】${topic.discussion}`,
            topic.examples && `【具体例】${topic.examples}`,
            topic.nextActions && `【次のアクション】${topic.nextActions}`,
          ].filter(Boolean).join("\n");

          return {
            title: topic.title || "",
            content: topic.content || legacyContent || "",
            // 旧形式フィールドも保持（後方互換）
            background: topic.background || "",
            currentStatus: topic.currentStatus || "",
            issues: topic.issues || "",
            discussion: topic.discussion || "",
            examples: topic.examples || "",
            nextActions: topic.nextActions || "",
          };
        }),
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
        // 6. 質疑応答
        qaItems: (parsedSummary.qaItems || []).map(
          (qa: { question?: string; answer?: string }) => ({
            question: qa.question || "",
            answer: qa.answer || "",
          })
        ),
        // 7. 次回に向けて
        nextSteps: parsedSummary.nextSteps || [],
        // メタ情報
        generatedAt: new Date().toISOString(),
        // 後方互換性
        importantNotes: parsedSummary.importantNotes || [],
        overview: parsedSummary.overview || parsedSummary.meetingInfo?.purpose || "",
        keyPoints: parsedSummary.keyPoints || parsedSummary.agenda || [],
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
