# Issue #80: 録音データへのタグ付けフィルタリング機能 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: Recording モデルに `tags?: string[]` フィールドは既に定義されているが、UI 上でタグの追加・表示・フィルタリングが **一切実装されていない**
- **影響範囲**: 録音が増えるとユーザーは検索・フォルダのみでの分類に限定され、横断的分類（例: 「重要」「議事録」「1on1」）ができない。全ユーザーに影響
- **修正の緊急度**: **P2（Medium）** — 機能未実装であり既存動作を壊すバグではないが、ユーザー体験改善に直結する

---

## 2. アーキテクチャ概観

### 2.1 対象機能のコンポーネント依存関係

```
Recording モデル (tags?: string[])
├── API 層
│   ├── api/src/models/recording.ts      ← tags フィールド定義済み ✅
│   ├── api/src/functions/recordings.ts  ← updateRecording で tags 保存可 ✅
│   ├── api/src/services/recordingService.ts ← listRecordings にタグフィルタ未対応 ⚠️
│   └── ListRecordingsQuery             ← tags パラメータ未定義 ⚠️
├── フロントエンド サービス層
│   ├── web/src/types/index.ts           ← tags?: string[] 定義済み ✅
│   ├── web/src/services/recordingsApi.ts ← UpdateRecordingInput.tags 定義済み ✅
│   └── recordingsApi.listRecordings()   ← tags パラメータ未対応 ⚠️
└── フロントエンド UI 層
    ├── web/src/app/recording/page.tsx    ← タグ表示・編集 UI なし ❌
    └── web/src/app/history/page.tsx      ← タグフィルタ UI なし ❌
```

### 2.2 データフロー

```
[ユーザー] → タグ追加/削除（recording/page.tsx）
    → recordingsApi.updateRecording(id, { tags })
    → PUT /api/recordings/{id}
    → recordingService.updateRecording() → CosmosDB 保存
    → レスポンス → UI 更新

[ユーザー] → タグフィルタ選択（history/page.tsx）
    → recordingsApi.listRecordings(page, limit, search, folderId, tag)
    → GET /api/recordings/list?tag=xxx
    → recordingService.listRecordings() → CosmosDB ARRAY_CONTAINS クエリ
    → フィルタ済み結果 → UI 表示
```

### 2.3 現状の状態管理

| フィールド | 定義場所 | API 対応 | UI 実装 |
|-----------|---------|---------|---------|
| `tags?: string[]` | recording.ts (API/Web 両方) | ✅ 保存可 | ❌ 未実装 |
| `folderId?: string` | recording.ts | ✅ フィルタ対応 | ✅ 実装済み |
| `search?: string` | ListRecordingsQuery | ✅ 全文検索 | ✅ 実装済み |

---

## 3. 重大バグ分析 🔴

Issue #80 はバグ報告ではなく新機能要望のため、既存バグは存在しない。

ただし以下の **潜在的問題** を指摘する：

### BUG-1: listRecordings API にタグフィルタ未対応
**場所**: `api/src/services/recordingService.ts` L121-173  
**コード**:
```typescript
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string  // ← tag パラメータなし
)
```
**問題**: `ListRecordingsQuery` にも `tag` パラメータが未定義。タグフィルタを実装するには API 側の拡張が必要  
**影響**: タグ UI を作っても、サーバー側フィルタができない  
**根本原因**: tags フィールドは将来機能として定義されたが、クエリ側は未実装  
**修正方針**: `listRecordings` に `tag?: string` パラメータを追加し、CosmosDB の `ARRAY_CONTAINS` で フィルタする  
**重要度**: High

---

## 4. 設計上の問題 🟡

### DESIGN-1: フロントエンド listRecordings の引数拡張性

**場所**: `web/src/services/recordingsApi.ts` L120-138  
**問題**: `listRecordings(page, limit, search, folderId)` は引数が増えるたびにシグネチャが肥大化する。オブジェクトパラメータにすべき  
**影響**: 保守性の低下（引数順序ミスのリスク）  
**対策**: 今回は既存パターンに合わせ引数追加で対応（リファクタリングは別 Issue で検討）  
**重要度**: Low

### DESIGN-2: タグの一意性・正規化

**問題**: タグに大文字小文字混在、空白付きなどが許容されると検索精度が下がる  
**対策**: フロントエンドで `trim().toLowerCase()` 正規化を行う  
**重要度**: Medium

### ✅ Good: データモデル設計

`Recording.tags?: string[]` は将来のタグ機能を見据えて事前に定義されており、CosmosDB ドキュメントに柔軟に配列を保存できる。追加のスキーマ変更不要で素晴らしい設計判断。

### ✅ Good: API の更新パターン

`UpdateRecordingRequest.tags?: string[]` も既に定義済みで、`updateRecording` の `...updates` スプレッドパターンにより追加コード不要で tags 保存が可能。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #80（タグ付け）──→ 独立（ブロッカーなし）
Issue #80 ←── Issue #81（全文検索）: 検索と共存する必要あり（AND フィルタ）
Issue #80 ←── Issue #83（フォルダ機能）: フォルダと共存する必要あり（AND フィルタ）
```

- **ブロッカー**: なし
- **並行作業**: 他 Issue と独立して実装可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| タグフィルタクエリ | CosmosDB ARRAY_CONTAINS | Low | CosmosDB ネイティブ対応 |
| タグ入力 UI | 既存 Input/Button | Low | 既存コンポーネントで十分 |
| i18n | ja/en/es.json | Low | キー追加のみ |

### 5.3 他 Issue/機能との相互作用

- **フォルダ機能（#83 実装済み）**: タグとフォルダは独立した分類軸。両方のフィルタを AND 条件で共存させる必要がある
- **全文検索（#81 実装済み）**: 検索 + タグフィルタの組み合わせをサポートする
- **Issue #82 自動言語検出**: 干渉なし

---

## 6. ブラウザ / 環境互換性リスク

該当なし。タグ機能は標準的な HTML/CSS/JS のみで実装可能。

---

## 7. 修正提案（優先順位付き）

### Phase 1: コア機能実装（P0）

#### 7.1 API: listRecordings にタグフィルタ追加

**変更ファイル**: `api/src/models/recording.ts`, `api/src/functions/recordings.ts`, `api/src/services/recordingService.ts`

```typescript
// api/src/models/recording.ts - ListRecordingsQuery に追加
export interface ListRecordingsQuery {
  userId: string;
  page?: number;
  limit?: number;
  folderId?: string;
  search?: string;
  tag?: string;       // ← 追加
}
```

```typescript
// api/src/services/recordingService.ts - listRecordings にタグフィルタ追加
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string,
  tag?: string         // ← 追加
): Promise<PaginatedResponse<Recording>> {
  // ...

  if (tag) {
    queryText += " AND ARRAY_CONTAINS(c.tags, @tag)";
    parameters.push({ name: "@tag", value: tag });
  }

  // ...
}
```

```typescript
// api/src/functions/recordings.ts - listRecordings ハンドラで tag パラメータ取得
const tag = request.query.get("tag") || undefined;
const result = await listRecordings(userId, page, limit, search, folderId, tag);
```

#### 7.2 フロントエンド API クライアント拡張

**変更ファイル**: `web/src/services/recordingsApi.ts`

```typescript
async listRecordings(
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string,
  tag?: string           // ← 追加
): Promise<ApiResponse<PaginatedResponse<Recording>>> {
  // ...
  if (tag) {
    params.append("tag", tag);
  }
  // ...
}
```

#### 7.3 録音詳細ページ: タグ編集 UI

**変更ファイル**: `web/src/app/recording/page.tsx`

メタ情報セクション（L771-783）の後にタグチップ表示 + 入力フィールドを追加:

```tsx
{/* Tags (Issue #80) */}
<div className="mt-3 flex flex-wrap items-center gap-2">
  <Tag className="h-4 w-4 text-gray-400" />
  {recording.tags?.map((tag) => (
    <span
      key={tag}
      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
    >
      {tag}
      <button
        onClick={() => handleRemoveTag(tag)}
        className="ml-0.5 text-blue-500 hover:text-blue-800"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  ))}
  {/* インライン追加 */}
  <form onSubmit={handleAddTag} className="inline-flex">
    <Input
      type="text"
      placeholder={t("addTagPlaceholder")}
      value={newTag}
      onChange={(e) => setNewTag(e.target.value)}
      className="h-6 w-28 text-xs px-2"
    />
  </form>
</div>
```

#### 7.4 履歴ページ: タグフィルタ UI

**変更ファイル**: `web/src/app/history/page.tsx`

検索バーとフォルダタブの間にタグフィルタチップを追加:

```tsx
{/* Tag Filter (Issue #80) */}
{allTags.length > 0 && (
  <div className="mb-4 flex items-center gap-2 overflow-x-auto">
    <Tag className="h-4 w-4 text-gray-400 flex-shrink-0" />
    {allTags.map((tag) => (
      <button
        key={tag}
        onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
        className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          selectedTag === tag
            ? "bg-blue-600 text-white"
            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
        }`}
      >
        {tag}
      </button>
    ))}
  </div>
)}
```

### Phase 2: UX 改善（P1）

- タグの **オートコンプリート**: 過去に使用したタグを候補として表示
- タグの **一括編集**: 複数録音に同じタグを付与
- 履歴ページの録音カードにタグチップを表示

### Phase 3: 堅牢性強化（P2）

- タグ数の上限設定（例: 10 個）
- タグ文字数の上限設定（例: 30 文字）
- バリデーション（空白・重複チェック）

---

## 8. テスト戦略

### 状態遷移テスト（Unit）
| テストケース | 期待結果 |
|-------------|---------|
| タグを追加 → 保存 | `recording.tags` に新しいタグが追加される |
| 重複タグを追加 | 追加されない（重複排除） |
| タグを削除 | `recording.tags` から除去される |
| 空文字タグを追加 | 追加されない |
| タグフィルタで検索 | 該当タグを持つ録音のみ返る |
| フォルダ + タグの複合フィルタ | AND 条件で絞り込み |

### 統合テスト
| シナリオ | 検証ポイント |
|---------|------------|
| 録音詳細でタグ追加 → 履歴で確認 | タグが永続化されフィルタで見つかる |
| タグフィルタ + 全文検索 | 両条件の AND で動作 |
| タグ削除 → フィルタ結果更新 | 即時反映される |

### 手動テスト
- デスクトップ / モバイルレスポンシブ確認（タグチップの折り返し）
- 日本語・英語・スペイン語の切り替え確認

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API: listRecordings にタグフィルタ追加 | 30分 | recordingService.ts, recordings.ts, recording.ts |
| 2 | フロントエンド: recordingsApi にタグパラメータ追加 | 15分 | recordingsApi.ts |
| 3 | 録音詳細ページ: タグ編集 UI 追加 | 1時間 | recording/page.tsx |
| 4 | 履歴ページ: タグフィルタ UI 追加 | 1時間 | history/page.tsx |
| 5 | i18n メッセージ追加（3言語） | 15分 | ja/en/es.json |
| 6 | ビルド確認・テスト | 30分 | - |
| 7 | PR 作成・デプロイ | 15分 | - |
| **合計** | | **約3.5時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| CosmosDB ARRAY_CONTAINS のパフォーマンス | Low | Low | タグ配列は小さい（<10件）ため問題なし |
| タグの正規化不足による検索ミス | Medium | Medium | 追加時に trim + lowercase 処理 |
| 履歴ページの allTags 集計パフォーマンス | Low | Low | クライアント側でローカル集計（50件以内） |
| i18n 翻訳の漏れ | Low | Low | 3言語分を同時に追加 |

---

## 11. 結論

- **最大のポイント**: データモデル・API 保存は既に対応済み。必要なのは API フィルタクエリ拡張 + フロントエンド UI 実装のみ
- **推奨修正順序**: API タグフィルタ → 録音詳細タグ編集 UI → 履歴ページタグフィルタ UI → i18n
- **他 Issue への影響**: なし（独立機能）
- **判定**: **GO** ✅ — ブロッカーなし、工数 S（3.5時間）、既存コードとの整合性も高い
