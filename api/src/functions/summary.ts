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

// ─── JSON出力フォーマット（議事録精度改善：詳細版）───
const JSON_FORMAT = `出力は必ず以下のJSON形式で返してください。
※重要: 以下はフォーマットの例示です。実際の出力では会議内容に応じて topics は8件以上、actionItems は5件以上になることがあります。省略せず全て記載してください。

{
  "caution": "センシティブ情報がある場合のみ記載。なければnull",

  "meetingInfo": {
    "title": "会議の具体的な名称（例: 'チーム週次定例', 'ケース運用・体制確認MTG'。不明なら内容から推測）",
    "participants": ["Guest-1", "Guest-2"],
    "datetime": "実施日時（不明なら『不明』）",
    "purpose": "会議の目的・背景を具体的に2-3文で記述。例: '直近のワークロード/体制見通しの共有、個別案件のクローズ方針決定、停滞案件の次アクション整理'"
  },

  "agenda": [
    "議題1: ワークロードの状況確認",
    "議題2: 人員変動に伴う体制見直し",
    "議題3: 個別案件A（SR4526）のクローズ方針",
    "議題4: 個別案件B（石川様）のフォロー",
    "議題5: 技術検証（PKI再現テスト）の進め方"
  ],

  "topics": [
    {
      "title": "近況・ワークロードの状況",
      "content": "（Guest-1）が最近のワークロードの状況を確認。JPでのアサインが多く、グローバルでは1日1件程度だが、JPはそれ以上に来ている。週あたりの処理規模感として**週15〜20件**のペースで回っている。（Guest-2）からはJPに偏っている印象との共有があった。"
    },
    {
      "title": "人員減少・4月の体制リスク",
      "content": "◯◯さんが育休に入る予定であり、**4月**が最も体制リスクが高い時期との認識を共有。APACタイムゾーンの関係で日本にケースが寄りやすい可能性が指摘された。渡辺さんの方針として『人数が減ってもワークロードを増やすのではなく、人数に合わせて仕事量を調整したい』との共有があったが、現実にはJP案件は来るため最終的には自分たちで捌く前提も確認。"
    },
    {
      "title": "個別案件: 渋沢様（SR4526）のクローズ判断",
      "content": "連絡が取れない状況。クローズ自体は避けられないが、タイミングが問題。過去の返信時間帯を分析し、翌日が平日のタイミングは避けたい。最終合意: **2/20（金）の夜、22〜23時目安**にクローズ実施。もし4/5以外の評価が返ってきたらフォロー対応。"
    }
  ],

  "decisions": [
    "人数が減っても仕事量は人数に合わせて調整する方針を共有",
    "渋沢様（SR4526）は2/20夜22〜23時にクローズする",
    "石川様案件は電話を2〜3回追加トライし、出なければ見切りクローズ",
    "PKI 289はGuest-1が再現検証を実施し、トレースを取得してGuest-2へ共有する"
  ],

  "actionItems": [
    {
      "id": "1",
      "task": "渋沢様（SR4526）を2/20夜遅めにクローズ。返答があればフォロー",
      "assignee": "Guest-1",
      "dueDate": "2026-02-20",
      "context": "連絡が取れない顧客。三連休前の金曜夜にクローズする方針"
    },
    {
      "id": "2",
      "task": "PKI 289の再現検証を実施し、トレースを取得・共有する",
      "assignee": "Guest-1",
      "dueDate": "2026-02-18",
      "context": "PG側で再現できない問題。OneLakeセキュリティ有効化+フォルダアップロードで再現テスト"
    },
    {
      "id": "3",
      "task": "石川様へ電話トライ継続（2〜3回）",
      "assignee": "Guest-2",
      "dueDate": "未定",
      "context": "エイジドが長い案件。電話で粘り、出なければ見切りクローズも視野"
    }
  ],

  "qaItems": [
    {
      "question": "インターナルタイトルの修正は明文化されたルールがあるか？",
      "answer": "明文化されたルールは見当たらない。説明責任を果たせる範囲で例外対応も許容される。ただしTracking ID文字列はセンシティブで検知トリガーになりうるため弄らない前提。"
    }
  ],

  "nextSteps": [
    "不在期間確定後に最終的な役割分担を再調整する",
    "長期オペレーション案件のピン間隔を短縮して対応",
    "次回定例で体制変更後の状況を再確認"
  ]
}

【書き方のルール】
1. 文字起こしの内容に忠実に。推測で事実を増やさない（不明点は「不明」「（要確認）」）
2. 時系列の流れが追えるように整理しつつ、話題の転換点を明確にする
3. 重要なニュアンス（懸念・温度感・言い回しの意図）は落とさない
4. 固有名詞（人名/顧客名/チーム名/ツール名/チケット番号）や数値は漏らさず拾う
5. 誰の発言かわかるものは（Guest-1）のように補足。文字起こしのラベルをそのまま使用
6. 参加者名は文字起こしのラベル（Guest-1等）をそのまま使う。推測で実名を付けない
7. 重要な数値・期間・時間帯は **太字** にする
8. 各 topic の content は最低200文字以上。第三者が読んでも文脈と結論が理解できる詳細さにする
9. 根拠のない推測は書かない
10. 必ず有効なJSONで出力
11. 省略しない。全話題・全決定事項・全アクションアイテムを記載する`;

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
以下の会議ログ（発話の羅列/文字起こし/メモ）から、「**網羅的で詳細な議事録**」を作成してください。

# 最重要ルール（これを最優先で守ること）
1. **会議で触れられた全ての話題を独立した topic として記録する**（漏れ禁止）
2. **各 topic の content は最低200文字以上**で、背景→議論経緯→結論/未決の流れで丁寧に記述する
3. **固有名詞（人名・顧客名・案件番号・製品名・数値・日時・期限）は全て拾って正確に記載する**
4. **参加者名は文字起こしに記載されたラベル（例: Guest-1, Guest-2）をそのまま使う。推測で実名を付けない**
5. **情報を省略・圧縮しない**。要約ではなく詳細な記録を作成する
6. **個別の案件・チケット・顧客についての議論は、それぞれ独立した topic として分けて記録する**

# 出力要件
- 事実ベースで、合意事項・未決事項・宿題を明確に分ける
- 時系列の流れが追えるように整理しつつ、話題の転換点で topic を分割する
- 聞き取りづらい・曖昧な箇所は断定せず「（要確認）」として残す
- 可能な範囲で Q&A 形式を抽出する
- 文体はビジネス向け、箇条書きと文章を適切に組み合わせて読みやすく

# 品質基準（必ず守ること）
- **1時間の会議** → topics **8〜15件**、actionItems **5〜10件**、decisions **3〜8件**
- **30分の会議** → topics **4〜8件**、actionItems **3〜5件**
- **15分の会議** → topics **2〜4件**、actionItems **1〜3件**
- 上記はあくまで最低ラインであり、会議内容が豊富ならさらに多くてよい

# フォーマット
1. 会議情報（会議名/開催形式/主目的を具体的に。参加者は文字起こしのラベルそのまま使用）
2. 議題・論点（全話題を箇条書き。漏れなく列挙。10件以上になることもある）
3. 主要な会話内容（全話題を時系列で。各話題に小見出し＋詳細記述。省略しない）
4. 決定事項（合意したこと全て。具体的な日時・担当・条件を含める）
5. 宿題・アクションアイテム（担当/期限/関連背景を含め、全て列挙）
6. 質疑応答（主な Q&A。未回答は「未回答・持ち帰り」と明記）
7. 次回に向けた進め方

# 追加ルール
- 重要な数値・期間・時間帯・制限は **太字** にする
- 参加者名が曖昧な場合は「（発話ログ上の呼称：◯◯）」のように書く
- 担当者間の役割分担・引き継ぎの議論は具体的に記録する
- 懸念・リスクに関する発言は漏らさず記録する
- 根拠のない推測は書かない

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

      const transcriptLines = body.transcript.split('\n').length;
      const transcriptLength = body.transcript.length;

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `以下は会議の文字起こしです（約${transcriptLines}発話、約${transcriptLength}文字）。\n全ての話題を漏れなく網羅した詳細な議事録を作成してください。情報を省略せず、会議で議論された全ての話題・決定事項・アクションアイテムを記載してください。\n\n---\n${body.transcript}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 16000,
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
