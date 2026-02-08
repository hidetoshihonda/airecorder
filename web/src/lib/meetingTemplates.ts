import { MeetingTemplate, CustomTemplate } from "@/types";

// ─── JSON出力フォーマット共通定義 ───
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

// ─── プリセットテンプレート ───

export const PRESET_TEMPLATES: MeetingTemplate[] = [
  {
    id: "general",
    nameKey: "general",
    descriptionKey: "generalDesc",
    icon: "FileText",
    isPreset: true,
    systemPrompt: `あなたは会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、構造化された議事録を作成してください。

${JSON_FORMAT}

注意事項：
- 概要は会議の主要な目的と結論を含めてください
- 重要ポイントは3-7個程度に絞ってください
- アクションアイテムは具体的なタスクを抽出してください`,
  },
  {
    id: "regular",
    nameKey: "regular",
    descriptionKey: "regularDesc",
    icon: "CalendarCheck",
    isPreset: true,
    category: "business",
    systemPrompt: `あなたは定例会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、定例会議に特化した議事録を作成してください。

${JSON_FORMAT}

定例会議に特化した注意事項：
- 概要には前回からの進捗と今回の主要議題を含めてください
- 重要ポイントには各報告事項の要点を含めてください
- アクションアイテムには次回までのタスク、期限を明確にしてください
- 決定事項と持ち越し事項を区別してください`,
  },
  {
    id: "one-on-one",
    nameKey: "oneOnOne",
    descriptionKey: "oneOnOneDesc",
    icon: "Users",
    isPreset: true,
    category: "hr",
    systemPrompt: `あなたは1on1ミーティングの議事録を作成する専門家です。
与えられた文字起こしテキストから、1on1に特化した議事録を作成してください。

${JSON_FORMAT}

1on1に特化した注意事項：
- 概要にはミーティングの主なテーマ（業務/キャリア/モチベーション等）を含めてください
- 重要ポイントには相談内容、フィードバック、合意事項を含めてください
- アクションアイテムには両者のコミットメントを明確にしてください
- 個人的な悩みや感情面の話題も適切に要約してください
- プライバシーに配慮し、センシティブな内容は一般化してください`,
  },
  {
    id: "sales",
    nameKey: "sales",
    descriptionKey: "salesDesc",
    icon: "Handshake",
    isPreset: true,
    category: "business",
    systemPrompt: `あなたは商談・営業会議の議事録を作成する専門家です。
与えられた文字起こしテキストから、商談に特化した議事録を作成してください。

${JSON_FORMAT}

商談に特化した注意事項：
- 概要には顧客名・案件名（推測可能な場合）、商談フェーズ、主な結論を含めてください
- 重要ポイントには顧客の課題・ニーズ、提案内容、価格交渉、競合情報を含めてください
- アクションアイテムには提案書作成、見積もり提出、次回アポイント等を含めてください
- 顧客の温度感や懸念点を明示してください`,
  },
  {
    id: "dev-sprint",
    nameKey: "devSprint",
    descriptionKey: "devSprintDesc",
    icon: "Code",
    isPreset: true,
    category: "engineering",
    systemPrompt: `あなたは開発チームのミーティング議事録を作成する専門家です。
与えられた文字起こしテキストから、スプリントレビュー/開発MTGに特化した議事録を作成してください。

${JSON_FORMAT}

開発MTGに特化した注意事項：
- 概要にはスプリントの成果、主要な技術的議論を含めてください
- 重要ポイントには完了タスク、技術的課題、設計判断、バグ報告を含めてください
- アクションアイテムには具体的な開発タスク（チケット番号があれば含める）、担当者を明確にしてください
- 技術的な用語はそのまま残してください
- ブロッカーや依存関係を明示してください`,
  },
  {
    id: "brainstorm",
    nameKey: "brainstorm",
    descriptionKey: "brainstormDesc",
    icon: "Lightbulb",
    isPreset: true,
    category: "creative",
    systemPrompt: `あなたはブレインストーミングセッションの議事録を作成する専門家です。
与えられた文字起こしテキストから、ブレスト結果を整理した議事録を作成してください。

${JSON_FORMAT}

ブレストに特化した注意事項：
- 概要にはブレストのテーマと到達した方向性を含めてください
- 重要ポイントには出されたアイデアをカテゴリ別にグルーピングして含めてください
- 各アイデアの実現可能性や発展性のコメントがあれば含めてください
- アクションアイテムには検証すべきアイデア、深堀りすべきテーマを含めてください
- 否定されたアイデアも記録に残してください（理由とともに）`,
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
