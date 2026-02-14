# Issue #103: 文字起こし補正（LLM補正）が失敗する — 分析レビュー

## 1. エグゼクティブサマリー

- **本質**: `transcriptCorrectionService.ts` が Azure OpenAI の APIキーを **誤った環境変数名** (`AZURE_OPENAI_API_KEY`) で参照しており、実際にデプロイされている環境変数名 (`AZURE_OPENAI_KEY`) と一致しないため、OpenAI 呼び出しが認証エラーで 100% 失敗する。
- **影響**: 全ユーザーの全録音で文字起こし補正が動作しない（影響率 100%）。
- **緊急度**: 🔴 **Critical** — コア機能の完全停止。修正自体は環境変数名の統一のみ（1行変更）。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
┌─────────────────────────────────────────────────────────────┐
│  Web (Next.js)                                              │
│                                                             │
│  page.tsx ──→ recordingsApi.createRecording()               │
│      │              │                                       │
│      │              ▼                                       │
│      │   POST /api/recordings ──→ recordingService.ts       │
│      │                                │                     │
│      │                                ▼                     │
│      │              processTranscriptCorrection() [非同期]   │
│      │                    │                                 │
│      │                    ▼                                 │
│      │          transcriptCorrectionService.ts              │
│      │                    │                                 │
│      │                    ▼                                 │
│      │           AzureOpenAI (❌ API Key 不一致)            │
│      │                    │                                 │
│      │                    ▼                                 │
│      │          correctionStatus = "failed"                 │
│      │                                                      │
│      │   recording/page.tsx                                 │
│      │         │                                            │
│      │         ▼                                            │
│      │   ポーリング (3秒間隔)                               │
│      │         │                                            │
│      │         ▼                                            │
│      │   correctionStatusBadge = "補正失敗" ❌              │
│      │                                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 データフロー

```
[ユーザー録音完了]
    │
    ▼
[Web] page.tsx: handleSave()
    │ POST /api/recordings  (transcript 含む)
    ▼
[API] recordingService.createRecording()
    │ Cosmos DB に correctionStatus="pending" で保存
    │ processTranscriptCorrection() を fire-and-forget で呼び出し
    ▼
[API] transcriptCorrectionService.processTranscriptCorrection()
    │ 1. Cosmos DB から recording を取得
    │ 2. correctionStatus → "processing" に patch
    │ 3. correctTranscript() 呼び出し ← ❌ ここで失敗
    │ 4. catch → correctionStatus → "failed" に patch
    ▼
[Web] recording/page.tsx:
    │ useEffect ポーリング (3秒ごと)
    │ correctionStatus === "failed" を検出
    ▼
[UI] "補正失敗" バッジ表示
```

### 2.3 状態管理

| State 変数 | 管理場所 | 型 |
|-----------|---------|-----|
| `recording.correctionStatus` | Cosmos DB / API レスポンス | `"pending" \| "processing" \| "completed" \| "failed"` |
| `recording.correctedTranscript` | Cosmos DB / API レスポンス | `Transcript \| undefined` |
| `recording.correctionError` | Cosmos DB / API レスポンス | `string \| undefined` |
| `transcriptView` | Web page.tsx (useState) | `"original" \| "corrected"` |

---

## 3. 重大バグ分析 🔴

### BUG-1: 環境変数名の不一致（API Key）【Critical】

**場所**: [api/src/services/transcriptCorrectionService.ts](../api/src/services/transcriptCorrectionService.ts) L33

**コード**:
```typescript
// transcriptCorrectionService.ts (補正 — ❌ 失敗)
const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,   // ← ❌ "AZURE_OPENAI_API_KEY"
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: "2024-02-15-preview",
});
```

```typescript
// summary.ts (議事録生成 — ✅ 動作)
const apiKey = process.env.AZURE_OPENAI_KEY;   // ← ✅ "AZURE_OPENAI_KEY"
const client = new AzureOpenAI({
  endpoint,
  apiKey,
  apiVersion: "2024-08-01-preview",
});
```

**問題**: `summary.ts` は `AZURE_OPENAI_KEY` を使い、`transcriptCorrectionService.ts` は `AZURE_OPENAI_API_KEY` を使っている。Azure Functions のアプリケーション設定（環境変数）には `AZURE_OPENAI_KEY` が設定されていると推定される（議事録生成が動作するため）。よって補正サービスは常に `undefined` をAPIキーとして渡し、認証エラーになる。

**影響**: 文字起こし補正機能が **全ユーザーで 100% 失敗** する。

**根本原因**: Issue #70 実装時に、既存の `summary.ts` とは異なる環境変数名を使用してしまった。実装計画書（Issue70_LLM文字起こし補正_実装計画書.md）にも `AZURE_OPENAI_API_KEY` と記載されており、計画段階からの齟齬。

**修正方針**:
```typescript
// transcriptCorrectionService.ts L33 を修正
const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,        // ← 統一
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: "2024-08-01-preview",            // ← summary.ts と統一
});
```

---

### BUG-2: API キー未設定時のバリデーション欠如【High】

**場所**: [api/src/services/transcriptCorrectionService.ts](../api/src/services/transcriptCorrectionService.ts) L30-38

**コード**:
```typescript
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2024-02-15-preview",
  });
  // ← バリデーションなし。undefinedのまま呼び出しに進む
```

**問題**: `summary.ts` では `if (!endpoint || !apiKey)` で事前チェックしているが、`transcriptCorrectionService.ts` にはこのバリデーションがない。そのため、APIキーが `undefined` でもクライアント生成が進み、API呼び出し時に初めてエラーになる。エラーメッセージが不明瞭になり、デバッグが困難。

**影響**: 障害の原因特定を遅延させる。ログに出るエラーが「認証エラー」か「ネットワークエラー」のような曖昧な内容になる。

**根本原因**: 防御的プログラミングの欠如。

**修正方針**:
```typescript
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

  if (!apiKey || !endpoint) {
    throw new Error(
      "Azure OpenAI is not configured: AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT are required"
    );
  }

  const client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: "2024-08-01-preview",
  });
  // ...
}
```

---

### BUG-3: apiVersion の不整合【Medium】

**場所**: [api/src/services/transcriptCorrectionService.ts](../api/src/services/transcriptCorrectionService.ts) L35

**コード**:
```typescript
// transcriptCorrectionService.ts
apiVersion: "2024-02-15-preview",   // ← 古いプレビュー版

// summary.ts
apiVersion: "2024-08-01-preview",   // ← 新しい版
```

**問題**: 同じアプリ内で異なる API バージョンを使用している。古いバージョンではサポートが終了している可能性がある。

**影響**: API バージョン非互換によるエラーの可能性。現時点では BUG-1 のためこの段階に到達しないが、BUG-1 修正後に顕在化する可能性。

**根本原因**: 実装時期の違いによるバージョン不統一。

**修正方針**: `"2024-08-01-preview"` に統一する。

---

## 4. 設計上の問題 🟡

### DESIGN-1: fire-and-forget パターンのエラーハンドリング不足

**場所**: [api/src/services/recordingService.ts](../api/src/services/recordingService.ts) L46-49

```typescript
// 非同期で補正処理をキック (Issue #70)
if (request.transcript?.fullText) {
  processTranscriptCorrection(result.id, result.userId).catch((err) => {
    console.error(`[Correction] Failed to start for ${result.id}:`, err);
  });
}
```

**問題点**:
- 補正失敗がログに出力されるのみで、**ユーザーに通知されない**
- `catch` 内の `console.error` のみでは、Azure Functions のアラート機構にも捕捉されにくい
- ✅ ただし、`processTranscriptCorrection` 内で `correctionStatus = "failed"` に更新するので、Web UI 側ではポーリングで検知できる → **設計としては許容範囲**

**改善案**: Application Insights のカスタムメトリクスを追加して、補正失敗率を監視可能にする。

### DESIGN-2: ポーリングによる補正ステータス監視

**場所**: [web/src/app/recording/page.tsx](../web/src/app/recording/page.tsx) L217-239

```typescript
const interval = setInterval(async () => {
  const response = await recordingsApi.getRecording(id);
  // ...
}, 3000);
```

**問題点**:
- 3秒間隔のポーリングは **API コスト** と **ネットワーク負荷** が増加
- 補正処理が長時間（OpenAI のレスポンスが遅い場合 30秒以上）かかるとポーリング回数が増える
- ✅ `correctionStatus` が `completed` / `failed` で `clearInterval` しているので無限ポーリングにはならない → **Good**

**改善案（将来）**: WebSocket / Server-Sent Events で push 通知に切り替え。

### DESIGN-3: 手動リトライ UI の欠如

**場所**: [web/src/app/recording/page.tsx](../web/src/app/recording/page.tsx)

**問題**: API側には `POST /api/recordings/{id}/correct` エンドポイントが存在するが、Web UI には補正失敗時のリトライボタンが実装されていない。ユーザーは失敗しても再試行する手段がない。

**修正方針**: `correctionStatus === "failed"` の場合に「再試行」ボタンを表示し、`/correct` エンドポイントを呼び出す。

### DESIGN-4: OpenAI設定の一元管理がない

**問題**: `summary.ts` と `transcriptCorrectionService.ts` が個別に環境変数を参照しており、設定の一元管理がない。

**修正方針**: `lib/openaiClient.ts` のようなファクトリーを作成し、OpenAI クライアント生成を共通化する。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #103 (本Issue: 補正失敗)
    │
    ├── 原因: Issue #70 の実装不備
    │
    ├── 関連: Issue #34 (フレーズリスト) → 補正精度に影響
    │
    └── 独立: 他Issueとのブロッカー関係なし
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| transcriptCorrectionService.ts | Azure OpenAI API | 環境変数名の不一致 | 変数名を統一 |
| transcriptCorrectionService.ts | Cosmos DB patch API | patch 操作の型安全性 | テスト追加 |
| recording/page.tsx | correctionStatus ポーリング | ステータス遷移の監視 | 現状で問題なし |

### 5.3 他機能との相互作用

- **議事録生成 (`summary.ts`)**: 同じ Azure OpenAI を使用するが、こちらは `AZURE_OPENAI_KEY` を正しく使っているため影響なし
- **録音保存フロー**: 補正は fire-and-forget なので、保存自体は正常に完了する
- **Issue #34 (フレーズリスト)**: 補正機能の前段で認識精度を上げる施策。補正修正後に相乗効果。

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Azure Functions (Node.js) | API サーバーサイド | 環境変数設定のみ → 低リスク |
| Web ブラウザ | ポーリングのみ（fetch API） | なし |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）⚡

#### 修正 1-1: 環境変数名の統一（BUG-1 + BUG-3）

**ファイル**: `api/src/services/transcriptCorrectionService.ts`

```typescript
// Before (L30-38):
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2024-02-15-preview",
  });

// After:
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

  if (!apiKey || !endpoint) {
    throw new Error(
      "Azure OpenAI is not configured: AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT are required"
    );
  }

  const client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: "2024-08-01-preview",
  });
```

**変更ファイル一覧**:
| ファイル | 変更内容 |
|---------|---------|
| `api/src/services/transcriptCorrectionService.ts` | 環境変数名修正 + バリデーション追加 + apiVersion統一 |

### Phase 2: 設計改善（P1）

#### 修正 2-1: 補正リトライ UI の追加（DESIGN-3）

**ファイル**: `web/src/app/recording/page.tsx`, `web/src/services/recordingsApi.ts`

- `recordingsApi` に `correctRecording(id: string)` メソッドを追加
- `correctionStatus === "failed"` 時に「再試行」ボタンをUI表示
- ボタンクリックで `POST /api/recordings/{id}/correct` を呼び出し

#### 修正 2-2: OpenAI クライアント生成の共通化（DESIGN-4）

**新規ファイル**: `api/src/services/openaiClient.ts`

```typescript
import { AzureOpenAI } from "openai";

export function createOpenAIClient(): AzureOpenAI {
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;

  if (!apiKey || !endpoint) {
    throw new Error("Azure OpenAI is not configured");
  }

  return new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: "2024-08-01-preview",
  });
}

export function getDeploymentName(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";
}
```

### Phase 3: 堅牢性強化（P2）

#### 修正 3-1: エラーメッセージの改善

- `correctionError` の内容をUI側で表示（現在は "補正失敗" のみ）
- ユーザーが問題を報告しやすいようにエラー詳細を提供

#### 修正 3-2: 補正失敗時の自動リトライ

- `processTranscriptCorrection` 内に最大3回のリトライロジックを追加
- exponential backoff で再試行

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|-------------|------|---------|
| 正常系: 補正成功 | transcript.fullText あり | correctionStatus = "completed", correctedTranscript 設定 |
| 異常系: API Key なし | AZURE_OPENAI_KEY 未設定 | エラー throw "Azure OpenAI is not configured" |
| 異常系: transcript なし | transcript.fullText 空 | スキップ（return） |
| 異常系: OpenAI タイムアウト | ネットワーク遅延 | correctionStatus = "failed", correctionError 設定 |

### 統合テスト

| シナリオ | 手順 | 確認項目 |
|---------|------|---------|
| E2E 補正フロー | 録音保存 → 補正完了 | ポーリングで "completed" を検知 |
| 失敗→リトライ | 補正失敗 → リトライボタン | "processing" → "completed" |
| 環境変数チェック | デプロイ後 | Azure Portal で AZURE_OPENAI_KEY 確認 |

### 手動テスト

| ブラウザ | テスト内容 |
|---------|---------|
| Chrome (最新) | 録音→保存→補正完了→切り替え表示 |
| Safari | 同上 |
| Mobile Chrome | 同上 |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | 環境変数名修正 + バリデーション（BUG-1,2,3） | 15分 | transcriptCorrectionService.ts |
| 2 | 単体テスト追加 | 30分 | テストファイル |
| 3 | デプロイ + 動作確認 | 15分 | Azure Functions |
| 4 | リトライUI追加（DESIGN-3） | 1時間 | recording/page.tsx, recordingsApi.ts |
| 5 | OpenAIクライアント共通化（DESIGN-4） | 30分 | openaiClient.ts, summary.ts, transcriptCorrectionService.ts |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| 環境変数名修正のみで解決しない | 低 | 高 | Azure Portal でログを確認し、他のエラーを特定 |
| apiVersion 変更で互換性問題 | 低 | 中 | 変更前にAzure OpenAIリソースの対応バージョンを確認 |
| Cosmos DB patch 操作の失敗 | 低 | 中 | 補正ステータス更新の try-catch は実装済み |
| OpenAIクライアント共通化時のリグレッション | 低 | 高 | 議事録生成の動作確認を含める |

---

## 11. 結論

### 最大の問題点

**環境変数名 `AZURE_OPENAI_API_KEY` vs `AZURE_OPENAI_KEY` の不一致** が根本原因。1行の修正で解決する極めてシンプルなバグ。

### 推奨する修正順序

1. **即座に修正**: `transcriptCorrectionService.ts` の環境変数名を `AZURE_OPENAI_KEY` に統一
2. **合わせて修正**: バリデーション追加 + apiVersion 統一
3. **次スプリント**: リトライUI + OpenAIクライアント共通化

### 他 Issue への影響

- 本修正は他 Issue に影響なし（独立した修正）
- Issue #34 (フレーズリスト) の実装時に補正精度が向上する相乗効果

### 判定

## ✅ `GO` — 即時修正可能。実装リスク極めて低い。

---

*分析日: 2026-02-13*
*分析者: ReviewAAgent*
