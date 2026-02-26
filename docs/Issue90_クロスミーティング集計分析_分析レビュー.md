# Issue #90: クロスミーティング集計分析 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 現在のアプリは個別録音単位でのみ要約・分析が可能であり、複数会議を横断した統合分析（共通テーマ抽出、アクションアイテム進捗追跡、トレンド可視化）ができない
- **影響範囲**: 週次定例・プロジェクト会議を頻繁に行うビジネスユーザー（推定アクティブユーザーの30-50%）に直接恩恵。競合差別化の高付加価値機能
- **修正の緊急度**: **P3（次世代AI差別化Phase 3）** — 既存機能のバグではなく新機能追加。ビジネス価値は高いが既存機能に影響なし

---

## 2. アーキテクチャ概観

### 2.1 対象機能のコンポーネント依存関係図

```
┌───────────────────────────────────────────────────────────────────────┐
│                     フロントエンド (Next.js)                          │
│                                                                       │
│  ┌─────────────────┐    ┌──────────────────────────────────────────┐ │
│  │  History Page    │───▶│  Cross Analysis Page (※新規)            │ │
│  │  (録音一覧)      │    │  ├─ 複数選択UI (チェックボックス)         │ │
│  │  ├─ チェックボックス│  │  ├─ 期間指定フィルタ                     │ │
│  │  └─ 分析ボタン    │    │  ├─ 分析結果表示                         │ │
│  └─────────────────┘    │  └─ レポートエクスポート                  │ │
│                          └──────────────────────────────────────────┘ │
│           │                              │                            │
│           ▼                              ▼                            │
│  ┌─────────────────┐    ┌──────────────────────────────────────────┐ │
│  │ recordingsApi    │    │ crossAnalysisApi (※新規)                 │ │
│  │ (既存)           │    │ POST /api/recordings/cross-analysis      │ │
│  └─────────────────┘    └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     バックエンド (Azure Functions)                     │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  crossAnalysis (※新規 Azure Function)                           │ │
│  │  ├─ 複数録音の取得 (Cosmos DB)                                   │ │
│  │  ├─ transcript 結合・構造化                                      │ │
│  │  ├─ Azure OpenAI (GPT) による横断分析                            │ │
│  │  └─ 分析結果のレスポンス                                         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│           │                     │                     │               │
│           ▼                     ▼                     ▼               │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐     │
│  │ Cosmos DB     │  │ Azure OpenAI     │  │ recordingService   │     │
│  │ (recordings)  │  │ (GPT-5-mini)     │  │ (既存)             │     │
│  └──────────────┘  └──────────────────┘  └────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.2 データフロー図

```
1. ユーザーが履歴ページで複数録音を選択（チェックボックス）
   ↓
2. 「クロス分析」ボタンをクリック / 期間指定で自動選択
   ↓
3. フロントエンド → POST /api/recordings/cross-analysis
   {
     recordingIds: string[],
     userId: string,
     analysisType: "summary" | "trends" | "action-tracking" | "full",
     dateRange?: { start: string, end: string }
   }
   ↓
4. API: 指定された録音を Cosmos DB から一括取得
   ↓
5. API: 各録音の correctedTranscript || transcript の fullText を結合
   （話者ラベル・日時メタデータ付き）
   ↓
6. API: Azure OpenAI (GPT) に横断分析プロンプトと結合テキストを投入
   ↓
7. API: 構造化された分析結果を JSON でレスポンス
   ↓
8. フロントエンド: 結果を可視化（サマリー/テーマ/進捗追跡/決定事項の変遷）
```

### 2.3 状態管理の構造

#### 既存の状態管理（History Page）
| State 変数 | 管理場所 | 用途 |
|------------|---------|------|
| `recordings` | `useState<Recording[]>` | 録音一覧データ |
| `searchQuery` / `debouncedSearch` | `useState<string>` | 検索フィルタ |
| `selectedFolderId` | `useState<string \| null>` | フォルダフィルタ |
| `selectedTag` | `useState<string \| null>` | タグフィルタ |
| `isLoading` | `useState<boolean>` | ローディング状態 |

#### 新規追加が必要な状態
| State 変数 | 管理場所 | 用途 |
|------------|---------|------|
| `selectedRecordingIds` | `useState<Set<string>>` | 複数選択された録音ID |
| `isSelectionMode` | `useState<boolean>` | 選択モードの ON/OFF |
| `crossAnalysisResult` | `useState<CrossAnalysisResult \| null>` | 分析結果 |
| `isAnalyzing` | `useState<boolean>` | 分析中フラグ |
| `analysisError` | `useState<string \| null>` | エラーメッセージ |
| `dateRange` | `useState<{ start: string, end: string } \| null>` | 期間指定 |

---

## 3. 重大バグ分析 🔴

> 本 Issue は新機能追加であり、既存のバグは対象外です。  
> ただし、実装時に注意すべき **設計上のリスク** を以下に記載します。

### BUG-RISK-1: トランスクリプト結合時のトークン上限超過 [Critical]

**場所**: 新規 `crossAnalysis` Azure Function  
**問題**: GPT-5-mini のコンテキストウィンドウ上限に対し、複数録音の fullText を単純結合するとトークン数が容易に超過する  
**影響**: API エラー（400/500）、分析失敗  
**根本原因**: 既存の `askAi.ts` では `MAX_TRANSCRIPT_CHARS = 80000` で1録音分の切り詰めを行っているが（[askAi.ts](../api/src/functions/askAi.ts#L93-L101)）、複数録音結合時には別途の戦略が必要  
**修正方針**:
1. 各録音の要約（summary）が既に存在する場合は fullText ではなく summary を使用する
2. summary が無い場合は各録音の fullText を一定文字数に切り詰めてから結合
3. 録音数が多すぎる場合は2段階分析（各録音→中間要約→統合分析）を実施
4. ユーザーに選択可能な録音数の上限を設ける（例: 最大20件）

### BUG-RISK-2: Cosmos DB クエリのパフォーマンス [High]

**場所**: `recordingService.ts` — 新規の複数録音一括取得  
**問題**: 現在の `getRecording()` は1件ずつ取得（point read）。N件を取得するにはN回のリクエストが必要  
**影響**: 10件の録音を選択した場合、10回の Cosmos DB リクエスト → レイテンシ増大  
**修正方針**: `WHERE c.id IN (...)` のバッチクエリを新規実装するか、`Promise.all` で並列取得。ただし Cosmos DB の IN 句は最大256値まで。

### BUG-RISK-3: レート制限（Azure OpenAI）[High]

**場所**: 新規 `crossAnalysis` Azure Function  
**問題**: 大量のトークンを使用する横断分析リクエストが Azure OpenAI のレート制限（TPM/RPM）に抵触する可能性  
**影響**: 429 エラー、分析失敗  
**修正方針**: 
- リトライロジック（exponential backoff）を実装
- 2段階分析でリクエストを分散
- フロントエンドでの連打防止

---

## 4. 設計上の問題 🟡

### 4.1 既存コードで活用可能な設計パターン ✅ Good

- **Summary 構造体の設計**: 既存の `Summary` 型（[recording.ts](../api/src/models/recording.ts#L24-L62)）は `actionItems`, `decisions`, `topics` を構造化しており、クロス分析の入力として再利用可能 ✅ Good
- **テンプレートベースのプロンプト設計**: `summary.ts` の `TEMPLATE_PROMPTS` パターン（[summary.ts](../api/src/functions/summary.ts#L85-L200)）は、クロス分析用のプロンプトテンプレート追加にそのまま適用可能 ✅ Good
- **API サービスのシングルトンパターン**: `recordingsApi` 等のサービスクラス設計は一貫しており、新規 `crossAnalysisApi` も同様のパターンで実装可能 ✅ Good

### 4.2 改善すべき設計上の課題

#### 4.2.1 履歴ページの肥大化 [Medium]

**場所**: [history/page.tsx](../web/src/app/history/page.tsx)（660行）  
**問題**: 既に660行あるモノリシックなページコンポーネントに、さらに複数選択UIや分析機能を追加すると責務過剰になる  
**修正方針**: 
- 録音カードを `RecordingCard` コンポーネントとして分離
- 選択ロジックを `useRecordingSelection` カスタムフックに分離
- クロス分析結果表示は専用ページ（`/cross-analysis`）またはモーダルとして分離

#### 4.2.2 フロントエンド型定義の二重管理 [Low]

**場所**: [web/src/types/index.ts](../web/src/types/index.ts) と [api/src/models/recording.ts](../api/src/models/recording.ts)  
**問題**: フロントエンドとバックエンドで `Recording`, `Summary` 等の型定義が別々に管理されており、不整合のリスクがある  
**備考**: 新規の `CrossAnalysisResult` 型も両方で定義する必要がある。将来的には共有パッケージの検討を推奨

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #90 (クロス分析)
  ├──▷ Issue #79 (ToDoリスト/アクションアイテムUI) [参照依存]
  │    └─ アクションアイテム進捗追跡にはアクションアイテムの構造化データが前提
  │       → 既存の Summary.actionItems で対応可能（ブロッカーではない）
  │
  ├──▷ Issue #87 (Word/PDFエクスポート) [機能連携]
  │    └─ クロス分析結果もエクスポートしたい場合に連携が必要
  │       → 独立実装可能。後から連携追加でOK
  │
  ├──▷ Issue #86 (ハイライト/ブックマーク) [弱い関連]
  │    └─ ブックマーク付き箇所だけをクロス分析対象にする拡張が考えられる
  │       → 完全に独立実装可能
  │
  └──▷ Issue #84 (API使用量表示) [運用依存]
       └─ クロス分析は大量のGPTトークンを消費するため、使用量表示が重要
          → ブロッカーではないが、同時期の実装を推奨
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| crossAnalysis API | Azure OpenAI (GPT) | トークン上限・レート制限 | 2段階分析、リトライ、入力制限 |
| crossAnalysis API | Cosmos DB (recordings) | N+1クエリ、パーティション跨ぎ | バッチクエリ実装 |
| 履歴ページ (複数選択UI) | 既存 recordings state | state 肥大化 | カスタムフック分離 |
| 分析結果表示 | 新規 CrossAnalysisResult 型 | 型定義の一貫性 | API/Web 両方で定義 |

### 5.3 他 Issue/機能との相互作用

| Issue | 相互作用 | 影響度 |
|-------|---------|--------|
| Issue #79 (ToDoリストUI) | アクションアイテム進捗追跡で連携可能 | Low（後から統合可能）|
| Issue #87 (エクスポート) | 分析結果のWord/PDF出力で連携 | Low（後から統合可能）|
| Issue #84 (API使用量) | GPTトークン消費量の可視化 | Medium（ユーザー体験に影響）|
| Issue #95 (テンプレート拡充) | クロス分析用テンプレートの追加 | Low |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Desktop) | ✅ 問題なし | — |
| Safari (Desktop/iOS) | ✅ 問題なし | UI のみ。Web API 依存なし |
| Firefox | ✅ 問題なし | — |
| Mobile (全般) | ⚠️ 注意 | チェックボックスUIのタッチ操作性、画面サイズ制約 |
| Azure OpenAI API | ⚠️ 注意 | トークン上限: gpt-5-mini は 128K context window。10録音×8000文字=80K文字でも余裕あるが、長時間会議では注意 |
| Cosmos DB | ✅ 問題なし | IN クエリは最大256値。録音20件制限で安全 |

---

## 7. 修正提案（優先順位付き）

### Phase 1: コア機能実装（P0） — 見積り: 5-7日

#### 7.1.1 バックエンド: Cross Analysis API

**新規ファイル**: `api/src/functions/crossAnalysis.ts`

```typescript
// POST /api/recordings/cross-analysis
interface CrossAnalysisRequest {
  recordingIds: string[];
  userId: string;
  analysisType: "summary" | "trends" | "action-tracking" | "full";
  dateRange?: { start: string; end: string };
}

interface CrossAnalysisResponse {
  // 全体サマリー
  overallSummary: string;
  // 共通テーマ
  commonThemes: Array<{
    theme: string;
    description: string;
    mentionedIn: string[]; // recording IDs
    frequency: number;
  }>;
  // アクションアイテム進捗追跡
  actionItemTracking: Array<{
    task: string;
    assignee: string;
    firstMentioned: string; // recording title + date
    lastMentioned: string;
    status: "new" | "in-progress" | "completed" | "stalled" | "dropped";
    history: Array<{
      recordingTitle: string;
      date: string;
      update: string;
    }>;
  }>;
  // 決定事項の変遷
  decisionEvolution: Array<{
    topic: string;
    decisions: Array<{
      recordingTitle: string;
      date: string;
      decision: string;
    }>;
  }>;
  // トレンド分析
  trends: {
    topicFrequency: Record<string, number>;
    sentimentTrend?: string;
    recurringIssues: string[];
  };
  // メタ情報
  analyzedRecordings: Array<{
    id: string;
    title: string;
    date: string;
  }>;
  generatedAt: string;
}
```

**主な実装ポイント**:
1. `getMultipleRecordings(ids, userId)` をバッチクエリで実装
2. 各録音の要約（summary）があればそれを使用、無ければ fullText を切り詰め
3. GPTプロンプトを横断分析専用に設計
4. レスポンスは構造化JSONで返却

#### 7.1.2 バックエンド: Recording Service 拡張

**変更ファイル**: `api/src/services/recordingService.ts`

```typescript
// 新規: 複数録音の一括取得
export async function getMultipleRecordings(
  ids: string[],
  userId: string
): Promise<Recording[]> {
  const container = await getRecordingsContainer();
  const placeholders = ids.map((_, i) => `@id${i}`).join(", ");
  const parameters = [
    { name: "@userId", value: userId },
    ...ids.map((id, i) => ({ name: `@id${i}`, value: id })),
  ];
  
  const { resources } = await container.items
    .query<Recording>({
      query: `SELECT * FROM c WHERE c.userId = @userId AND c.id IN (${placeholders})`,
      parameters,
    })
    .fetchAll();
  
  return resources;
}
```

#### 7.1.3 フロントエンド: Cross Analysis API Service

**新規ファイル**: `web/src/services/crossAnalysisApi.ts`

#### 7.1.4 フロントエンド: 履歴ページに複数選択UI追加

**変更ファイル**: `web/src/app/history/page.tsx`
- チェックボックス付き選択モードの追加
- 「クロス分析」ボタンの追加
- 選択件数の表示

### Phase 2: 結果表示・UX改善（P1） — 見積り: 3-5日

#### 7.2.1 クロス分析結果ページ

**新規ファイル**: `web/src/app/cross-analysis/page.tsx`
- 全体サマリー表示
- 共通テーマのカード表示
- アクションアイテム進捗のタイムライン表示
- 決定事項の変遷表示

#### 7.2.2 期間指定フィルタ

**変更ファイル**: `web/src/app/history/page.tsx` または新規コンポーネント
- DatePicker による週次/月次フィルタ
- 期間指定での自動録音選択

### Phase 3: 堅牢性強化（P2） — 見積り: 2-3日

#### 7.3.1 2段階分析の実装
- 大量の録音選択時（>10件）の中間要約→統合分析フロー
- ストリーミングレスポンス（SSE）対応

#### 7.3.2 エラーハンドリング強化
- トークン上限超過時のフォールバック
- レート制限時のリトライ（exponential backoff）
- 部分的な録音取得失敗時のグレースフルデグラデーション

#### 7.3.3 結果のキャッシュ・保存
- 分析結果の Cosmos DB 保存（再閲覧用）
- エクスポート機能（Markdown/JSON）

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|-------------|------|---------|
| 録音0件選択で分析ボタン | 空の selectedRecordingIds | ボタンdisabled |
| 録音1件選択で分析ボタン | 1件の ID | 「最低2件の録音を選択してください」エラー |
| 録音21件選択 | 21件の ID | 「最大20件まで選択可能です」エラー |
| 正常な分析リクエスト | 3件の有効なID | 200 + 分析結果JSON |
| 他ユーザーの録音ID指定 | 他ユーザーの録音ID | 404 or 403 |
| summary あり録音 | summary 付き録音 | summary を入力として使用 |
| summary なし録音 | summary なし録音 | fullText を切り詰めて使用 |
| トークン上限超過 | 非常に長い fullText | 2段階分析にフォールバック |

### 8.2 統合テスト

| シナリオ | モック | 検証内容 |
|---------|--------|---------|
| Cross Analysis API E2E | Cosmos DB + OpenAI をモック | リクエスト→レスポンスの一貫性 |
| 複数選択UI → API 呼び出し | API をモック | 選択状態 → リクエストボディの正確性 |
| エラーハンドリング | OpenAI 429 エラーをモック | リトライロジックの動作確認 |

### 8.3 手動テスト

| テストケース | 手順 | 確認事項 |
|-------------|------|---------|
| 基本フロー | 3件の録音を選択 → 分析実行 | 結果が表示されること |
| 期間フィルタ | 週次で期間指定 → 自動選択 | 指定期間の録音のみ選択されること |
| モバイル | スマホで複数選択 → 分析実行 | チェックボックスが操作しやすいこと |
| 大量選択 | 15件の録音を選択 → 分析実行 | タイムアウトしないこと（<60秒） |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | データモデル定義（CrossAnalysisRequest/Response 型） | 0.5日 | api/models, web/types |
| 2 | Recording Service: `getMultipleRecordings` 追加 | 0.5日 | api/services/recordingService.ts |
| 3 | Cross Analysis API Function 実装 | 2日 | api/functions/crossAnalysis.ts（新規） |
| 4 | フロントエンド API Service 実装 | 0.5日 | web/services/crossAnalysisApi.ts（新規） |
| 5 | 履歴ページ: 複数選択UI実装 | 1.5日 | web/app/history/page.tsx |
| 6 | クロス分析結果表示ページ | 2日 | web/app/cross-analysis/page.tsx（新規） |
| 7 | 期間指定フィルタ実装 | 1日 | web/components/DateRangeFilter.tsx（新規） |
| 8 | i18n 対応（ja/en/es） | 0.5日 | web/messages/ |
| 9 | エラーハンドリング・リトライ | 1日 | api/functions/crossAnalysis.ts |
| 10 | テスト・動作確認 | 1日 | — |
| **合計** | | **10.5日** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| GPT トークン上限超過 | 高 | 高 | 2段階分析、summary 優先使用、録音数上限 |
| Azure OpenAI レート制限 (429) | 中 | 高 | exponential backoff、リトライ、キュー化 |
| 分析結果の品質ばらつき | 中 | 中 | プロンプトチューニング、テンプレート化 |
| 履歴ページの複雑化 | 中 | 中 | コンポーネント分離、カスタムフック化 |
| Azure Functions タイムアウト (230秒) | 低 | 高 | ストリーミング化、分割処理 |
| Cosmos DB RU 消費増大 | 低 | 低 | バッチクエリ最適化 |
| モバイルでのチェックボックス操作性 | 中 | 低 | タッチ対応のUI設計、長押し選択モード |

---

## 11. 結論

### 最大の問題点の再確認
1. **トークン管理**: 複数録音のテキスト結合時のGPTコンテキストウィンドウ管理が最大の技術的課題。summary が存在する録音は要約データを再利用し、存在しない録音のみ fullText を使用する2段階戦略が必須
2. **パフォーマンス**: 複数録音の Cosmos DB 一括取得と、GPT呼び出しの応答時間（10-60秒）に対する UX 設計（ローディング、ストリーミング）が重要

### 推奨する修正順序
1. **Step 1-3**: バックエンド API の実装（型定義 → バッチ取得 → 分析API）
2. **Step 4-5**: フロントエンドの選択UI（API Service → 履歴ページ改修）
3. **Step 6-7**: 結果表示ページと期間フィルタ
4. **Step 8-10**: i18n・エラーハンドリング・テスト

### 他 Issue への影響サマリー
- **Issue #79 (ToDoリストUI)**: アクションアイテム進捗追跡との連携で相乗効果。独立実装可能
- **Issue #84 (API使用量表示)**: GPTトークン消費増大に対する可視化が重要。並行実装を推奨
- **Issue #87 (エクスポート)**: 分析結果のエクスポートは後から統合可能

### 判定: **`GO`** ✅
- 既存機能への破壊的変更なし
- 技術的なリスクは manageable（トークン管理の戦略が明確）
- 競合差別化の高付加価値機能
- 既存のアーキテクチャパターン（Azure Functions + Cosmos DB + OpenAI）の延長で実装可能
