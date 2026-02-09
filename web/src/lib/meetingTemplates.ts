import { MeetingTemplate, CustomTemplate } from "@/types";

// ─── JSON出力フォーマット共通定義（改善版 Issue #42）───
const JSON_FORMAT = `出力は必ず以下のJSON形式で返してください：
{
  "overview": "会議の詳細な概要（300-500字）。以下を必ず含める：
    ・会議の目的と背景
    ・参加者の役割（推測可能な場合）
    ・議論された主な議題の一覧
    ・最終的な結論・決定事項の要約",
  "keyPoints": [
    "【議題1: タイトル】背景: ... / 議論: ... / 結論: ...",
    "【議題2: タイトル】背景: ... / 議論: ... / 結論: ...",
    "【決定事項】...",
    "【懸念・リスク】...",
    "【持ち越し事項】..."
  ],
  "actionItems": [
    {
      "id": "1",
      "description": "【カテゴリ】具体的なタスク内容（誰が何をするか明確に）",
      "assignee": "担当者名",
      "dueDate": "YYYY-MM-DD"
    }
  ]
}

構造化の指示：
1. keyPointsは議題ごとに「背景→議論→結論」の3段階で整理
2. 【決定事項】【懸念・リスク】【持ち越し事項】は個別のkeyPointとして追加
3. 話者の発言は「〇〇さんは〜と述べた」形式で記録
4. actionItemsは以下のカテゴリで分類:
   - 【フォローアップ】確認・調査タスク
   - 【作成・準備】資料作成・準備タスク
   - 【連絡・調整】コミュニケーションタスク
   - 【実施】実行タスク
5. 担当者や期限が不明な場合はnull
6. 必ず有効なJSONで出力`;

// ─── プリセットテンプレート（改善版 Issue #42）───

export const PRESET_TEMPLATES: MeetingTemplate[] = [
  {
    id: "general",
    nameKey: "general",
    descriptionKey: "generalDesc",
    icon: "FileText",
    isPreset: true,
    systemPrompt: `あなたは会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、会議に参加していなかった人でも内容を理解できる詳細な議事録を作成してください。

${JSON_FORMAT}

一般会議の議事録作成指示：
- 複数の議題がある場合は、それぞれ独立したkeyPointとして記述
- 発言者が特定できる場合は「〇〇さん」と明記
- 議論の経緯（問題提起→意見交換→結論）を追える構成に
- 数値やデータが言及された場合は必ず含める
- 未解決の課題や今後の検討事項も漏れなく記録`,
  },
  {
    id: "regular",
    nameKey: "regular",
    descriptionKey: "regularDesc",
    icon: "CalendarCheck",
    isPreset: true,
    category: "business",
    systemPrompt: `あなたは定例会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、チームメンバーが進捗を追跡できる詳細な議事録を作成してください。

${JSON_FORMAT}

定例会議に特化した指示：
- overviewに「前回からの主な進捗」「今回の主要議題」「次回までの重点事項」を含める
- keyPointsは以下の構造で整理:
  【進捗報告】担当者: 報告内容 / 状況: 順調or遅延orブロック
  【課題共有】課題内容 / 影響範囲 / 対応方針
  【決定事項】決定内容 / 理由
  【持ち越し】内容 / 次回確認予定
- actionItemsは「次回定例まで」「今週中」「今月中」等の時間軸で整理
- KPIや数値目標への言及があれば必ず記録`,
  },
  {
    id: "one-on-one",
    nameKey: "oneOnOne",
    descriptionKey: "oneOnOneDesc",
    icon: "Users",
    isPreset: true,
    category: "hr",
    systemPrompt: `あなたは1on1ミーティングの議事録を作成する専門家です。
与えられた文字起こしテキストから、両者の合意事項と成長支援に役立つ議事録を作成してください。

${JSON_FORMAT}

1on1に特化した指示：
- overviewに「今回のメインテーマ」「全体的な雰囲気・状態」「主な合意事項」を含める
- keyPointsは以下のカテゴリで整理:
  【業務相談】課題内容 / アドバイス / 合意した対応
  【キャリア】話題 / 本人の考え / フィードバック
  【モチベーション】状態 / 背景 / サポート内容
  【FB（フィードバック）】具体的なフィードバック内容
  【称賛】良かった点の具体例
- 感情面の話題も「〇〇について不安を感じている」等、適切に要約
- プライバシーに配慮し、センシティブな固有名詞は一般化
- actionItemsは上司/部下の両方のコミットメントを明記`,
  },
  {
    id: "sales",
    nameKey: "sales",
    descriptionKey: "salesDesc",
    icon: "Handshake",
    isPreset: true,
    category: "business",
    systemPrompt: `あなたは商談・営業会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、商談の進捗管理とネクストアクションが明確な議事録を作成してください。

${JSON_FORMAT}

商談に特化した指示：
- overviewに「顧客名・案件名」「商談フェーズ」「顧客の温度感」「主な結論」を含める
- keyPointsは以下の構造で整理:
  【ニーズ・課題】顧客が抱える課題、要望
  【提案内容】自社からの提案、デモ内容
  【顧客反応】ポジティブ/ネガティブな反応、質問
  【競合情報】言及された競合、比較ポイント
  【価格・条件】価格交渉、条件面の議論
  【懸念・障壁】導入の障壁、社内調整の課題
  【決定事項】合意した内容
- actionItemsは「【提案】」「【見積】」「【フォロー】」「【社内調整】」で分類
- 次回アポイントの日時が決まっていれば必ず記録`,
  },
  {
    id: "dev-sprint",
    nameKey: "devSprint",
    descriptionKey: "devSprintDesc",
    icon: "Code",
    isPreset: true,
    category: "engineering",
    systemPrompt: `あなたは開発チームのミーティング議事録を作成する専門家です。
与えられた文字起こしテキストから、スプリントの状況とブロッカーが明確な議事録を作成してください。

${JSON_FORMAT}

開発MTGに特化した指示：
- overviewに「スプリント番号/期間」「完了予定のゴール」「現在のステータス」「主要なブロッカー」を含める
- keyPointsは以下の構造で整理:
  【完了】タスク名(チケット番号) / 担当者 / 成果
  【進行中】タスク名 / 進捗% / 残作業
  【ブロッカー】内容 / 影響 / 対応策
  【技術議論】議題 / 検討した選択肢 / 決定
  【バグ報告】内容 / 優先度 / 担当
  【設計判断】決定内容 / 理由 / トレードオフ
- 技術用語、API名、ライブラリ名はそのまま残す
- actionItemsにはチケット番号があれば含める
- 依存関係やマイルストーンへの影響を明記`,
  },
  {
    id: "brainstorm",
    nameKey: "brainstorm",
    descriptionKey: "brainstormDesc",
    icon: "Lightbulb",
    isPreset: true,
    category: "creative",
    systemPrompt: `あなたはブレインストーミングセッションの議事録を作成する専門家です。
与えられた文字起こしテキストから、アイデアの全体像と今後の方向性がわかる議事録を作成してください。

${JSON_FORMAT}

ブレストに特化した指示：
- overviewに「ブレストのテーマ」「到達した方向性」「特に有望なアイデア」を含める
- keyPointsは以下の構造で整理:
  【アイデア: カテゴリA】
    - アイデア1: 概要 / 発案者 / 評価コメント
    - アイデア2: 概要 / 発案者 / 評価コメント
  【アイデア: カテゴリB】...
  【却下されたアイデア】内容 / 却下理由
  【深堀りが必要】内容 / 検証ポイント
  【融合アイデア】複数アイデアの組み合わせ
- アイデアの実現可能性（高/中/低）を可能な範囲で評価
- actionItemsは「【検証】」「【リサーチ】」「【プロトタイプ】」「【関係者確認】」で分類`,
  },
];

// ─── カスタムテンプレート管理 (localStorage) ───

const CUSTOM_TEMPLATES_KEY = "airecorder-custom-templates";

export function loadCustomTemplates(): CustomTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: CustomTemplate[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
}

export function addCustomTemplate(template: Omit<CustomTemplate, "id" | "createdAt" | "updatedAt">): CustomTemplate {
  const templates = loadCustomTemplates();
  const newTemplate: CustomTemplate = {
    ...template,
    id: `custom-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  templates.push(newTemplate);
  saveCustomTemplates(templates);
  return newTemplate;
}

export function updateCustomTemplate(id: string, updates: Partial<Pick<CustomTemplate, "name" | "description" | "systemPrompt">>): CustomTemplate | null {
  const templates = loadCustomTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return null;
  templates[index] = { ...templates[index], ...updates, updatedAt: new Date().toISOString() };
  saveCustomTemplates(templates);
  return templates[index];
}

export function deleteCustomTemplate(id: string): boolean {
  const templates = loadCustomTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  if (filtered.length === templates.length) return false;
  saveCustomTemplates(filtered);
  return true;
}

/** カスタムテンプレートを MeetingTemplate に変換 */
export function customToMeetingTemplate(custom: CustomTemplate): MeetingTemplate {
  return {
    id: custom.id,
    nameKey: custom.name,        // カスタムは直接名前を使用
    descriptionKey: custom.description,
    icon: "PenSquare",
    isPreset: false,
    systemPrompt: custom.systemPrompt,
  };
}

/** プリセット + カスタムの全テンプレートを取得 */
export function getAllTemplates(): MeetingTemplate[] {
  const customs = loadCustomTemplates().map(customToMeetingTemplate);
  return [...PRESET_TEMPLATES, ...customs];
}

/** IDからテンプレートを検索 */
export function getTemplateById(id: string): MeetingTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}
