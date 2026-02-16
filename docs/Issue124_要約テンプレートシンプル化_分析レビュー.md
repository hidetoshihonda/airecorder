# Issue #124: 議事録「要約」テンプレートをシンプルな内容要約に変更する — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 「要約」テンプレート（templateId="summary"）選択時、API側に対応するプロンプトが存在せず `general`（詳細議事録フォーマット）にフォールバックしている。フロントエンドには `PRESET_TEMPLATES` にシンプルな要約用の `systemPrompt` が定義済みだが、プリセットテンプレートの場合は `customPrompt` として送信されない設計のため、API側のフォールバックが使用される。
- **影響範囲**: 「要約」テンプレートを選択するユーザーの100%に影響
- **修正の緊急度**: **P2 — Medium**（誤った出力形式だが、内容自体は生成される）

## 2. アーキテクチャ概観

### テンプレート解決フロー

```
フロントエンド (recording/page.tsx)
  ├── selectedTemplateId: "summary" (デフォルト)
  ├── handleGenerateSummary()
  │   ├── templateId: "summary" を送信
  │   ├── カスタムの場合のみ customPrompt を送信 (L476-478)
  │   └── プリセットは templateId のみ
  │
  └─→ API (summary.ts)
      ├── resolveSystemPrompt(templateId="summary", customPrompt=undefined)
      │   ├── customPrompt? → No
      │   ├── TEMPLATE_PROMPTS["summary"]? → 🔴 存在しない!
      │   └── fallback → TEMPLATE_PROMPTS["general"] ← 詳細議事録フォーマット
      └── LLM に詳細フォーマットで生成指示 → 10セクション構成の議事録が出力
```

### テンプレート定義の二重構造（設計問題）

```
フロントエンド: web/src/lib/meetingTemplates.ts
  └── PRESET_TEMPLATES[0] = { id: "summary", systemPrompt: "シンプル要約..." }
      ↑ カスタムテンプレートのときだけ使われる（プリセットは無視される）

API: api/src/functions/summary.ts
  └── TEMPLATE_PROMPTS = { general, regular, one-on-one, sales, dev-sprint, brainstorm }
      ↑ "summary" キーが存在しない → general にフォールバック
```

### データフロー

```
[ユーザー操作]
  → テンプレート「要約」選択（selectedTemplateId = "summary"）
  → 「AIで議事録を生成」ボタンクリック
  → handleGenerateSummary()

[フロントエンド → API]
  POST /api/summary/generate
  body: { transcript: "...", templateId: "summary", language: "ja-JP" }
  ※ customPrompt は undefined（プリセットなので送らない）

[API 内部]
  resolveSystemPrompt("summary", undefined)
  → TEMPLATE_PROMPTS["summary"] → undefined
  → fallback: TEMPLATE_PROMPTS["general"]  ← 🔴 詳細議事録フォーマット

[LLM 応答]
  → 10セクション構成の詳細議事録JSON
  → フロントで表示（会議情報、アジェンダ、議題別詳細、決定事項…全部表示される）
```

## 3. 重大バグ分析 🔴

### BUG-1: API に "summary" テンプレートが欠落（Critical）

**場所**: `api/src/functions/summary.ts` L143-L231 (`TEMPLATE_PROMPTS`)

**コード**:
```typescript
const TEMPLATE_PROMPTS: Record<string, string> = {
  general: `...`,      // ✅ 存在
  regular: `...`,      // ✅ 存在
  "one-on-one": `...`, // ✅ 存在
  sales: `...`,        // ✅ 存在
  "dev-sprint": `...`, // ✅ 存在
  brainstorm: `...`,   // ✅ 存在
  // 🔴 "summary" が存在しない!
};
```

**問題**: フロントエンドのデフォルトテンプレートが "summary" であるにもかかわらず、API 側に対応するプロンプトが存在しない。

**影響**: 「要約」テンプレートを選択（デフォルト）したユーザー全員が、意図に反して詳細議事録フォーマットで出力される。

**根本原因**: フロントエンドの `PRESET_TEMPLATES` にはシンプル要約用の `systemPrompt` が定義されているが、プリセットテンプレートの場合は API 側の `TEMPLATE_PROMPTS` を使う設計。API 側に "summary" を追加する作業が漏れていた。

**修正方針**: API の `TEMPLATE_PROMPTS` に "summary" キーを追加する。出力形式は `overview` + `keyPoints` + `actionItems` のシンプル構造。

### BUG-2: フロントエンドの応答パーシングが詳細フォーマット前提（Medium）

**場所**: `api/src/functions/summary.ts` L318-L365 (`SummaryResponse` 構築部分)

**コード**:
```typescript
const summary: SummaryResponse = {
  caution: parsedSummary.caution || undefined,
  meetingInfo: { ... },    // "summary" テンプレでは不要
  agenda: [...],            // "summary" テンプレでは不要
  topics: [...],            // "summary" テンプレでは不要
  decisions: [...],         // "summary" テンプレでは不要
  actionItems: [...],
  importantNotes: [...],    // "summary" テンプレでは不要
  overview: parsedSummary.meetingInfo?.purpose || parsedSummary.overview || "",
  keyPoints: parsedSummary.agenda || parsedSummary.keyPoints || [],
};
```

**問題**: レスポンス構築ロジックが詳細フォーマット優先。`parsedSummary.overview` が `meetingInfo?.purpose` よりも後に参照されるため、LLM が `overview` を返しても `meetingInfo.purpose` が存在すると上書きされる。

**影響**: "summary" テンプレートでシンプル JSON を返しても、フロントエンドの表示ロジックは後方互換フォールバック（`!recording.summary.meetingInfo && recording.summary.overview`）で表示される想定だが、`meetingInfo` がデフォルト値で常に存在するため**フォールバック表示が発動しない可能性**がある。

**修正方針**: レスポンス構築時に `overview` フィールドを正しく設定する。`parsedSummary.overview` を優先的に使用し、`meetingInfo` はLLM応答に存在する場合のみ設定する。

## 4. 設計上の問題 🟡

### 4.1 テンプレートプロンプトの二重管理
- フロントエンド（`meetingTemplates.ts`）とAPI（`summary.ts`）の両方にシステムプロンプトが定義されている
- プリセットテンプレートは API 側のみ使用、カスタムテンプレートは FE 側から送信
- **改善案**: 統一的な管理方法の検討（ただし今回のスコープ外）

### 4.2 レスポンス構造の柔軟性不足
- `SummaryResponse` が詳細フォーマット前提で定義されており、シンプル要約に最適化されていない
- `overview` / `keyPoints` が後方互換フィールドとして存在するが、表示ロジックの条件分岐が複雑

### 4.3 フロントエンド表示の条件分岐
- `recording/page.tsx` L1105-1127: `!recording.summary.meetingInfo && recording.summary.overview` の条件は、`meetingInfo` がデフォルト値で常にセットされるため**到達不能コード**になっている可能性

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係
```
Issue #124 (要約テンプレ) ──→ Issue #120 (話者ラベル) [なし: 独立]
Issue #124 (要約テンプレ) ──→ Issue #121 (モバイルUI) [なし: 独立]
```
→ 並行作業可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `TEMPLATE_PROMPTS` 追加 | LLM 出力形式 | Medium | プロンプトで JSON 形式を厳密に指定 |
| レスポンスパーシング | `SummaryResponse` 型 | Low | 既存の後方互換フィールドを活用 |
| フロントエンド表示 | 後方互換コード | Low | 条件分岐の改善 |

## 6. ブラウザ / 環境互換性リスク

該当なし（API 側のプロンプト変更のみ）

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

**修正箇所**: `api/src/functions/summary.ts`

#### 修正 A: `TEMPLATE_PROMPTS` に "summary" キーを追加

```typescript
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
- 箇条書きは簡潔に（各20-50字程度）
- actionItemsは明確なものがあれば記載、なければ空配列
- 必ず有効なJSONで出力`,

  general: `...（既存のまま）`,
  // ... 他のテンプレートも既存のまま
};
```

#### 修正 B: レスポンス構築ロジックの改善

```typescript
// 後方互換性（旧形式のフィールドも含める）
overview: parsedSummary.overview || parsedSummary.meetingInfo?.purpose || "",
keyPoints: parsedSummary.keyPoints || parsedSummary.agenda || [],
```

`overview` を `meetingInfo?.purpose` より**先に**参照するように変更。

**変更ファイル一覧**:
- `api/src/functions/summary.ts`（2箇所: TEMPLATE_PROMPTS 追加 + レスポンス構築修正）

### Phase 2: 設計改善（P1）
- フロントエンドの `meetingTemplates.ts` の `PRESET_TEMPLATES[0]`（summary）と API 側のプロンプトを一致させる
- 表示ロジックの到達不能コードを整理（別 Issue 推奨）

## 8. テスト戦略

### 手動テスト
1. 「要約」テンプレート選択 → 議事録生成 → シンプルな要約が表示される ✅
2. 「議事録」テンプレート選択 → 議事録生成 → 詳細フォーマットが表示される ✅
3. 他の全テンプレート → 正常に生成される（リグレッションなし）✅
4. 「要約」で生成後 → コピーボタン → シンプルな要約がコピーされる ✅

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `TEMPLATE_PROMPTS` に "summary" 追加 | 5分 | API summary.ts |
| 2 | レスポンス構築ロジック修正 | 3分 | API summary.ts |
| 3 | ビルド確認 | 2分 | - |
| 4 | 手動テスト（要約 + 他テンプレ） | 10分 | - |
| **合計** | | **20分** | |

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| LLM が指定 JSON 形式を守らない | Low | Medium | `response_format: { type: "json_object" }` が適用済み |
| 既存の「要約」結果の表示崩れ | Low | Low | 後方互換フィールドで吸収 |
| 他テンプレートへの影響 | Very Low | High | "summary" キー追加のみなので他に影響なし |

## 11. 結論

- **最大の問題**: API 側に "summary" テンプレートが存在しないため、全リクエストが "general" にフォールバック
- **推奨修正順序**: TEMPLATE_PROMPTS 追加 → レスポンス構築修正 → テスト
- **他 Issue への影響**: なし（完全に独立した API 変更）
- **判定**: **GO** ✅ — 修正範囲が小さく、既存テンプレートに影響しない。即時実装可能。
