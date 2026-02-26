# Issue #90: クロスミーティング集計分析 — 実装計画書

## 概要

複数の録音を選択して統合的に分析し、横断的な要約・トレンド・アクションアイテムの進捗追跡を行う機能。  
本書は [分析レビュー](./Issue90_クロスミーティング集計分析_分析レビュー.md) の結果に基づく詳細実装計画です。

---

## 1. 新規ファイル一覧

| # | ファイルパス | 種類 | 説明 |
|---|-------------|------|------|
| 1 | `api/src/models/crossAnalysis.ts` | Model | クロス分析の型定義 |
| 2 | `api/src/functions/crossAnalysis.ts` | Function | Azure Function エンドポイント |
| 3 | `web/src/services/crossAnalysisApi.ts` | Service | フロントエンド API クライアント |
| 4 | `web/src/app/cross-analysis/page.tsx` | Page | 分析結果表示ページ |
| 5 | `web/src/hooks/useRecordingSelection.ts` | Hook | 録音の複数選択ロジック |
| 6 | `web/src/components/CrossAnalysisResult.tsx` | Component | 分析結果表示コンポーネント |
| 7 | `web/src/components/DateRangeFilter.tsx` | Component | 期間指定フィルタコンポーネント |

## 2. 変更ファイル一覧

| # | ファイルパス | 変更内容 |
|---|-------------|---------|
| 1 | `api/src/models/index.ts` | crossAnalysis モデルの re-export 追加 |
| 2 | `api/src/services/recordingService.ts` | `getMultipleRecordings()` メソッド追加 |
| 3 | `web/src/types/index.ts` | `CrossAnalysisResult` 等の型追加 |
| 4 | `web/src/services/index.ts` | `crossAnalysisApi` の re-export 追加 |
| 5 | `web/src/app/history/page.tsx` | 複数選択UI（チェックボックス、分析ボタン）追加 |
| 6 | `web/messages/ja.json` | 日本語メッセージ追加 |
| 7 | `web/messages/en.json` | 英語メッセージ追加 |

---

## 3. 詳細実装仕様

### 3.1 データモデル定義

#### `api/src/models/crossAnalysis.ts` (新規)

```typescript
// === リクエスト ===
export interface CrossAnalysisRequest {
  recordingIds: string[];
  userId: string;
  analysisType: "summary" | "trends" | "action-tracking" | "full";
  dateRange?: {
    start: string; // ISO 8601
    end: string;   // ISO 8601
  };
}

// === レスポンス ===
export interface CrossAnalysisResponse {
  /** 全体サマリー（全録音を通した概要） */
  overallSummary: string;

  /** 共通テーマ */
  commonThemes: CommonTheme[];

  /** アクションアイテム進捗追跡 */
  actionItemTracking: ActionItemTrack[];

  /** 決定事項の変遷 */
  decisionEvolution: DecisionEvolution[];

  /** トレンド分析 */
  trends: TrendAnalysis;

  /** 分析対象の録音メタデータ */
  analyzedRecordings: AnalyzedRecording[];

  /** 生成日時 */
  generatedAt: string;
}

export interface CommonTheme {
  theme: string;
  description: string;
  mentionedIn: string[];   // recording titles
  frequency: number;
}

export interface ActionItemTrack {
  task: string;
  assignee: string;
  firstMentioned: string;  // "会議名 (yyyy/mm/dd)"
  lastMentioned: string;
  status: "new" | "in-progress" | "completed" | "stalled" | "dropped";
  history: Array<{
    recordingTitle: string;
    date: string;
    update: string;
  }>;
}

export interface DecisionEvolution {
  topic: string;
  decisions: Array<{
    recordingTitle: string;
    date: string;
    decision: string;
  }>;
}

export interface TrendAnalysis {
  topicFrequency: Record<string, number>;
  sentimentTrend?: string;
  recurringIssues: string[];
}

export interface AnalyzedRecording {
  id: string;
  title: string;
  date: string;
  duration: number;
}
```

#### `web/src/types/index.ts` への追加

```typescript
// === Cross Analysis Types (Issue #90) ===
export interface CrossAnalysisResult {
  overallSummary: string;
  commonThemes: Array<{
    theme: string;
    description: string;
    mentionedIn: string[];
    frequency: number;
  }>;
  actionItemTracking: Array<{
    task: string;
    assignee: string;
    firstMentioned: string;
    lastMentioned: string;
    status: "new" | "in-progress" | "completed" | "stalled" | "dropped";
    history: Array<{
      recordingTitle: string;
      date: string;
      update: string;
    }>;
  }>;
  decisionEvolution: Array<{
    topic: string;
    decisions: Array<{
      recordingTitle: string;
      date: string;
      decision: string;
    }>;
  }>;
  trends: {
    topicFrequency: Record<string, number>;
    sentimentTrend?: string;
    recurringIssues: string[];
  };
  analyzedRecordings: Array<{
    id: string;
    title: string;
    date: string;
    duration: number;
  }>;
  generatedAt: string;
}
```

---

### 3.2 バックエンド: Recording Service 拡張

#### `api/src/services/recordingService.ts` への追加

```typescript
/**
 * 複数録音を一括取得 (Issue #90)
 * Cosmos DB の IN クエリでバッチ取得（最大20件）
 */
export async function getMultipleRecordings(
  ids: string[],
  userId: string
): Promise<Recording[]> {
  if (ids.length === 0) return [];
  if (ids.length > 20) {
    throw new Error("Maximum 20 recordings can be selected for cross-analysis");
  }

  const container = await getRecordingsContainer();

  // IN クエリ用のパラメータを動的に構築
  const placeholders = ids.map((_, i) => `@id${i}`).join(", ");
  const parameters: Array<{ name: string; value: string }> = [
    { name: "@userId", value: userId },
    ...ids.map((id, i) => ({ name: `@id${i}`, value: id })),
  ];

  const { resources } = await container.items
    .query<Recording>({
      query: `SELECT * FROM c WHERE c.userId = @userId AND c.id IN (${placeholders}) ORDER BY c.createdAt ASC`,
      parameters,
    })
    .fetchAll();

  return resources;
}
```

---

### 3.3 バックエンド: Cross Analysis API

#### `api/src/functions/crossAnalysis.ts` (新規)

**主要ロジック**:

```typescript
// 1. リクエストバリデーション
//    - userId 必須
//    - recordingIds: 2件以上、20件以下
//    - analysisType: enum チェック

// 2. 複数録音の取得
const recordings = await getMultipleRecordings(body.recordingIds, body.userId);
if (recordings.length < 2) {
  return error("At least 2 recordings are required");
}

// 3. 各録音のコンテキスト構築
//    - summary がある場合 → summary の JSON を使用（トークン節約）
//    - summary がない場合 → correctedTranscript || transcript の fullText を使用
//    - 各録音のメタデータ（タイトル、日時）を付与

// 4. トークン管理
//    - 全テキストが MAX_CROSS_ANALYSIS_CHARS (100,000) 以下になるよう調整
//    - 超過する場合: summary がない録音の fullText を段階的に切り詰め

// 5. GPT 呼び出し
//    - 専用のシステムプロンプト（CROSS_ANALYSIS_SYSTEM_PROMPT）
//    - response_format: { type: "json_object" }
//    - temperature: 0.3, max_tokens: 16000

// 6. レスポンス構築
//    - GPT 出力を CrossAnalysisResponse にマッピング
//    - generatedAt, analyzedRecordings のメタ情報を付与
```

**GPT プロンプト設計**:

```
あなたは複数の会議の横断分析を行う専門家です。
以下に複数の会議の記録が時系列順に提供されます。
これらを統合的に分析し、以下の観点で構造化された結果を出力してください。

【分析観点】
1. 全体サマリー: 全会議を通した総括（200-300文字）
2. 共通テーマ: 複数の会議で繰り返し議論されたテーマ
3. アクションアイテム進捗: 会議間でのタスクの進捗状況追跡
4. 決定事項の変遷: 同一トピックに関する決定がどう変化したか
5. トレンド: 議論の傾向、繰り返し発生する課題

【出力JSON形式】
{
  "overallSummary": "...",
  "commonThemes": [...],
  "actionItemTracking": [...],
  "decisionEvolution": [...],
  "trends": { "topicFrequency": {...}, "recurringIssues": [...] }
}
```

---

### 3.4 フロントエンド: API Service

#### `web/src/services/crossAnalysisApi.ts` (新規)

```typescript
import { CrossAnalysisResult, ApiResponse } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "...";

export interface CrossAnalysisInput {
  recordingIds: string[];
  userId: string;
  analysisType: "summary" | "trends" | "action-tracking" | "full";
  dateRange?: { start: string; end: string };
}

class CrossAnalysisApiService {
  private baseUrl: string;
  constructor() { this.baseUrl = API_BASE_URL; }

  async analyze(input: CrossAnalysisInput): Promise<ApiResponse<CrossAnalysisResult>> {
    const url = `${this.baseUrl}/recordings/cross-analysis`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        return { error: data?.error || `HTTP error ${response.status}` };
      }
      return { data: (data?.data || data) as CrossAnalysisResult };
    } catch (error) {
      return { error: (error as Error).message || "Network error" };
    }
  }
}

export const crossAnalysisApi = new CrossAnalysisApiService();
```

---

### 3.5 フロントエンド: 録音選択フック

#### `web/src/hooks/useRecordingSelection.ts` (新規)

```typescript
import { useState, useCallback } from "react";

const MAX_SELECTION = 20;
const MIN_SELECTION = 2;

export function useRecordingSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SELECTION) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids.slice(0, MAX_SELECTION)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  return {
    selectedIds,
    isSelectionMode,
    selectedCount: selectedIds.size,
    canAnalyze: selectedIds.size >= MIN_SELECTION,
    isMaxReached: selectedIds.size >= MAX_SELECTION,
    toggleSelection,
    selectAll,
    clearSelection,
    enterSelectionMode,
    exitSelectionMode,
  };
}
```

---

### 3.6 フロントエンド: 履歴ページの変更

#### `web/src/app/history/page.tsx` への変更概要

1. **import 追加**:
   - `useRecordingSelection` フック
   - `BarChart3`, `CheckSquare`, `Square` アイコン（lucide-react）

2. **選択モード切替ボタン**:
   - ヘッダー領域に「選択して分析」ボタンを追加
   - 選択モードON時にフローティングバーを表示（選択数 + 分析開始ボタン）

3. **録音カードにチェックボックス追加**:
   - `isSelectionMode` 時のみチェックボックスを表示
   - 選択済みの録音カードにハイライト（border-blue-500）

4. **分析実行フロー**:
   - 「分析開始」ボタンクリック → selectedIds を sessionStorage に保存
   - `/cross-analysis` ページへ遷移

---

### 3.7 フロントエンド: 分析結果表示ページ

#### `web/src/app/cross-analysis/page.tsx` (新規)

**構成**:
```
CrossAnalysisPage
├── ヘッダー（タイトル + 戻るボタン + エクスポートボタン）
├── 分析対象の録音一覧（コンパクトリスト）
├── Tabs
│   ├── "全体サマリー"
│   │   └── overallSummary + commonThemes カード
│   ├── "アクションアイテム追跡"
│   │   └── actionItemTracking テーブル + ステータスバッジ
│   ├── "決定事項の変遷"
│   │   └── decisionEvolution タイムライン表示
│   └── "トレンド"
│       └── topicFrequency バーチャート + recurringIssues リスト
└── フッター（生成日時 + 再分析ボタン）
```

---

## 4. i18n 対応

### `web/messages/ja.json` 追加キー

```json
{
  "HistoryPage": {
    "selectAndAnalyze": "選択して分析",
    "cancelSelection": "選択解除",
    "selectedCount": "{count}件選択中",
    "startCrossAnalysis": "クロス分析を実行",
    "maxSelectionReached": "最大20件まで選択可能です",
    "minSelectionRequired": "2件以上の録音を選択してください"
  },
  "CrossAnalysisPage": {
    "title": "クロスミーティング分析",
    "analyzing": "分析中...",
    "analysisFailed": "分析に失敗しました",
    "overallSummary": "全体サマリー",
    "commonThemes": "共通テーマ",
    "actionTracking": "アクションアイテム追跡",
    "decisionEvolution": "決定事項の変遷",
    "trends": "トレンド分析",
    "mentionedIn": "{count}件の会議で言及",
    "statusNew": "新規",
    "statusInProgress": "進行中",
    "statusCompleted": "完了",
    "statusStalled": "停滞",
    "statusDropped": "中止",
    "recurringIssues": "繰り返し発生する課題",
    "reAnalyze": "再分析",
    "export": "エクスポート",
    "backToHistory": "履歴に戻る",
    "analyzedRecordings": "分析対象の録音",
    "generatedAt": "生成日時: {date}"
  }
}
```

---

## 5. エラーハンドリング設計

| エラーケース | API レスポンス | フロントエンド表示 |
|-------------|---------------|-------------------|
| 録音数不足（<2件） | 400 "At least 2 recordings required" | 「2件以上の録音を選択してください」 |
| 録音数超過（>20件） | 400 "Maximum 20 recordings" | 「最大20件まで選択可能です」 |
| 録音が見つからない | 404 "Recordings not found" | 「選択した録音が見つかりません」 |
| transcript なし | 400 "No transcript data" | 「文字起こしデータがありません」 |
| OpenAI 未設定 | 500 "Azure OpenAI not configured" | 「AI分析サービスが利用できません」 |
| トークン超過 | 500 (内部リトライ後) | 「データ量が多すぎます。選択数を減らしてください」 |
| レート制限 (429) | 429 → リトライ → 最終失敗時 500 | 「サーバーが混雑しています。しばらくお待ちください」 |
| タイムアウト | 504 | 「分析に時間がかかっています。少し待ってから再度お試しください」 |

---

## 6. セキュリティ考慮事項

| 項目 | 対策 |
|------|------|
| 認可 | `userId` による録音所有権チェック（既存パターン踏襲） |
| 他ユーザーの録音アクセス | `getMultipleRecordings` で `userId` を WHERE 条件に含める |
| API キー露出 | Azure OpenAI は API 経由のみ呼び出し（クライアント直接アクセスなし）|
| 入力バリデーション | recordingIds の件数上限、型チェック |
| レート制限 | Azure Functions のスケーリング + OpenAI の TPM/RPM 制限 |

---

## 7. パフォーマンス最適化

| 最適化項目 | 実装方法 |
|-----------|---------|
| DB アクセス | IN クエリによるバッチ取得（N+1 回避） |
| トークン節約 | summary がある録音は fullText の代わりに summary JSON を使用 |
| レスポンス時間 | ローディングUI + 進捗表示 |
| 再分析コスト | 同一録音セットの結果をクライアント側キャッシュ（sessionStorage） |
| フロントエンド | 選択ロジックをカスタムフックに分離し不要な re-render を防止 |

---

## 8. 将来の拡張ポイント

| 拡張 | 説明 | 関連 Issue |
|------|------|-----------|
| 定期レポート自動生成 | 週次/月次で自動的にクロス分析を実行 | 新規 Issue 候補 |
| 分析結果の保存 | Cosmos DB に保存して再閲覧可能に | — |
| Word/PDF エクスポート | 分析結果を文書形式で出力 | Issue #87 |
| ストリーミング分析 | SSE でリアルタイムに結果を表示 | — |
| AI チャット連携 | 分析結果に対して Ask AI で質問 | Issue #85 の拡張 |
| ダッシュボード化 | 常時表示型の分析ダッシュボード | — |
