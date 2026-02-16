# Issue #81: 全文検索（文字起こしテキスト内キーワード検索）— 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 現在の検索機能は **タイトルのみ** を対象としており、文字起こしテキスト（transcript.fullText）内のキーワード検索ができない。履歴ページの横断検索と録音詳細ページ内検索の2つの検索 UX が欠落している
- **影響範囲**: 全ユーザーの検索体験（録音が蓄積されるほど影響大。10 件以上の録音を持つアクティブユーザーの 100% に影響）
- **修正の緊急度**: **P2 — High**（競合 5/10 製品が搭載済み。ギャップ分析 G-03）

---

## 2. アーキテクチャ概観

### 2.1 現在の検索フロー

```
[履歴ページ] searchQuery state
    ↓ useEffect / fetchRecordings
recordingsApi.listRecordings(page, limit, search, folderId)
    ↓ HTTP GET
/api/recordings/list?userId=xxx&search=keyword
    ↓ Azure Functions
listRecordings(userId, page, limit, search, folderId)
    ↓ CosmosDB SQL
"SELECT * FROM c WHERE c.userId = @userId AND CONTAINS(LOWER(c.title), LOWER(@search))"
    ↓
結果: タイトルにマッチした録音のみ返却
```

### 2.2 コンポーネント依存関係

```
HistoryPage (history/page.tsx)
├── searchQuery state (L62)
├── useEffect → recordingsApi.listRecordings(search=searchQuery) (L125-142)
├── Search <Input> (L407-415)
└── Recording list (map)

RecordingDetailPage (recording/page.tsx)
├── displayTranscript.fullText ← 一括表示のみ（ページ内検索 UI なし）
└── ※ #135 でセグメント表示化 → セグメント単位のハイライト基盤ができる

API (api/src)
├── functions/recordings.ts → listRecordings handler
│   └── search query param → CONTAINS(LOWER(c.title), LOWER(@search))
└── services/recordingService.ts → listRecordings()
    └── ★ title のみ検索。transcript.fullText は検索対象外
```

### 2.3 データ構造（CosmosDB）

```json
{
  "id": "...",
  "userId": "...",
  "title": "週次定例 7/10",
  "transcript": {
    "fullText": "本日の議題は... （数千文字のテキスト）",
    "segments": [...]
  },
  "correctedTranscript": {
    "fullText": "本日の議題は... （補正済みテキスト）",
    "segments": [...]
  }
}
```

---

## 3. 重大バグ分析 🔴

> Issue #81 はバグではなく機能要望。ただし、現状の検索実装に潜在的問題がある。

### BUG-1: 検索が debounce なしで即時 API 呼び出し [Medium]

**場所**: `web/src/app/history/page.tsx` L125-142, L62  
**コード**:
```tsx
const [searchQuery, setSearchQuery] = useState("");

useEffect(() => {
  // ...
  const fetchData = async () => {
    const response = await recordingsApi.listRecordings(
      1, 50, searchQuery || undefined, selectedFolderId || undefined
    );
    // ...
  };
  fetchData();
}, [searchQuery, selectedFolderId, isAuthenticated, authLoading]);
```
**問題**: `searchQuery` は `onChange` で毎キーストロークごとに更新され、useEffect の依存配列に含まれているため、キーストロークごとに API リクエストが発生する。現在は title 検索のみで高速だが、全文検索を追加すると CosmosDB の RU 消費が爆増する。  
**影響**: API コスト増大、レスポンス遅延。全文検索追加後は重大度 High  
**根本原因**: debounce が未実装  
**修正方針**: debounce (300-500ms) を追加するか、form の onSubmit でのみ検索実行に統一する

### BUG-2: searchQuery が useEffect とフォーム submit の両方で発火 [Low]

**場所**: `web/src/app/history/page.tsx` L125-142, L273-276  
**コード**:
```tsx
// useEffect で searchQuery 変更時に自動 fetch
useEffect(() => { fetchData(); }, [searchQuery, ...]);

// フォーム submit でも手動 fetch
const handleSearch = (e: React.FormEvent) => {
  e.preventDefault();
  fetchRecordings();
};
```
**問題**: Enter キーでフォーム送信すると `handleSearch()` が呼ばれるが、その時点で既に useEffect が同じ searchQuery で fetch 済み → 二重リクエスト  
**影響**: 低（同一結果の重複取得）  
**修正方針**: useEffect での自動検索を debounce 付きにし、handleSearch は手動トリガー用に残す

---

## 4. 設計上の問題 🟡

### 4.1 API が title のみ検索 [Critical for #81]

**場所**: `api/src/services/recordingService.ts` L131-134  
**コード**:
```typescript
if (search) {
  queryText += " AND CONTAINS(LOWER(c.title), LOWER(@search))";
  parameters.push({ name: "@search", value: search });
}
```
**問題**: `CONTAINS` が `c.title` のみを対象としている。`c.transcript.fullText` や `c.correctedTranscript.fullText` が検索対象外。  
**改善方針**: 
- **Option A (推奨)**: API 側で `CONTAINS(LOWER(c.transcript.fullText), LOWER(@search))` を OR 条件で追加
- **Option B**: フロントエンドのインメモリ検索（一度全件取得してクライアント側でフィルタ）
- **推奨は Option A**: データ量増加時にスケーラブル

### 4.2 ✅ Good: 検索 UI の基盤は既に存在

**場所**: `web/src/app/history/page.tsx` L407-415  
```tsx
<form onSubmit={handleSearch} className="mb-6">
  <div className="relative">
    <Search className="absolute left-3 top-1/2 h-4 w-4 ..." />
    <Input type="search" placeholder={t("searchPlaceholder")} className="pl-10"
      value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
  </div>
</form>
```
検索バー UI は既に実装済み。フルテキスト検索を追加しても UI の変更は最小限。

### 4.3 録音詳細ページにページ内検索 UI がない [Medium]

**場所**: `web/src/app/recording/page.tsx` 全体  
**問題**: 長い文字起こしテキスト内でキーワードを探す手段がブラウザの Ctrl+F のみ。#135 でセグメント表示にすると、ブラウザ検索でもヒットするが、アプリ内検索 UI + ハイライト + 前後ナビゲーションがあるとより良い。  
**改善方針**: Phase 2 として、録音詳細ページにインライン検索バー + マッチハイライト + Prev/Next ナビゲーションを追加。

### 4.4 フロント → API の検索パラメータが search のみ [Low]

**場所**: `web/src/services/recordingsApi.ts` L113-129  
**問題**: `search` パラメータが 1 つしかなく、「タイトル検索」と「全文検索」を区別できない。  
**改善方針**: 当面は同一パラメータで title + transcript 両方を検索するため問題ない。将来的に高度な検索フィルタが必要になった場合は `searchField` パラメータ追加を検討。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #81 (全文検索) ──→ Issue #135 (タイムコード同期) [補完: セグメント表示基盤を活用してハイライト可能]
Issue #81 ──→ Issue #83 (フォルダ分類) [相互: フォルダ + 検索の複合フィルタは既に動作]
```

- **ブロッカー**: なし。#81 は独立して実装可能
- **推奨**: #135 を先に実装するとページ内検索のハイライトがセグメント単位で可能になる

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| API 全文検索 | CosmosDB CONTAINS | RU 消費増加 | インデックス最適化 or 結果キャッシュ |
| フロント検索 | recordingsApi.listRecordings | パラメータ互換 | 既存 search パラメータ流用 |
| ページ内検索 | displayTranscript.segments | segments 空の場合 | fullText 内でのテキスト検索にフォールバック |
| debounce | 新規 hook or setTimeout | - | カスタム useDebounce or lodash.debounce |

### 5.3 他 Issue/機能との相互作用

| 既存機能 | 相互作用 | リスク |
|---------|---------|--------|
| フォルダフィルタ (#83) | フォルダ + 全文検索の複合条件 | None: 既に AND 条件で動作 |
| LLM補正 (#70) | correctedTranscript.fullText も検索対象に含めるべきか | Low: 含めると検索精度向上 |
| #135 セグメント表示 | ページ内検索でセグメント単位ハイライト可能 | None: 良い相乗効果 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| CosmosDB CONTAINS 関数 | 全バージョン対応 | None |
| フロントエンド String.includes() | 全主要ブラウザ | None |
| CSS `<mark>` ハイライト | 全主要ブラウザ | None |
| 日本語検索 | CosmosDB CONTAINS はバイト比較ではなく文字列比較 | Low: 正規表現検索非対応 |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 履歴ページの全文検索（P0）

#### 変更 1: API — transcript.fullText を検索対象に追加

**ファイル**: `api/src/services/recordingService.ts`

```typescript
// Before:
if (search) {
  queryText += " AND CONTAINS(LOWER(c.title), LOWER(@search))";
  parameters.push({ name: "@search", value: search });
}

// After:
if (search) {
  queryText += " AND (CONTAINS(LOWER(c.title), LOWER(@search)) OR CONTAINS(LOWER(c.transcript.fullText), LOWER(@search)) OR CONTAINS(LOWER(c.correctedTranscript.fullText), LOWER(@search)))";
  parameters.push({ name: "@search", value: search });
}
```

#### 変更 2: 検索結果にマッチ箇所のスニペット表示

**ファイル**: `web/src/app/history/page.tsx`

```tsx
// 録音カード内に、transcript からのスニペット表示を追加
{searchQuery && recording.transcript?.fullText && 
  recording.transcript.fullText.toLowerCase().includes(searchQuery.toLowerCase()) && (
  <div className="mt-2 text-xs text-gray-500 bg-yellow-50 rounded p-2">
    <span className="font-medium">📝 </span>
    {getSearchSnippet(recording.transcript.fullText, searchQuery)}
  </div>
)}
```

#### 変更 3: debounce 追加

**ファイル**: `web/src/app/history/page.tsx`

```tsx
// debounce 用の state
const [debouncedSearch, setDebouncedSearch] = useState("");

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(searchQuery);
  }, 400);
  return () => clearTimeout(timer);
}, [searchQuery]);

// useEffect の依存を debouncedSearch に変更
useEffect(() => {
  fetchData();
}, [debouncedSearch, selectedFolderId, isAuthenticated, authLoading]);
```

### Phase 2: 録音詳細ページ内検索（P1）

#### 変更 4: ページ内検索バー追加

**ファイル**: `web/src/app/recording/page.tsx`

トランスクリプトタブ内にインライン検索バーを追加:
- 検索入力フィールド（Ctrl+F でフォーカス）
- マッチ数表示（「3/10」形式）
- Prev / Next ナビゲーションボタン
- マッチ箇所を `<mark>` タグでハイライト
- #135 のセグメント表示と統合

```tsx
// 検索 state
const [transcriptSearch, setTranscriptSearch] = useState("");
const [matchIndex, setMatchIndex] = useState(0);

// セグメントテキスト内のハイライト
function highlightText(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 rounded">{part}</mark>
      : part
  );
}
```

### Phase 3: 堅牢性強化（P2）

- 検索結果のスニペット生成最適化（前後 50 文字 + ハイライト）
- 検索履歴のサジェスト（localStorage）
- 大量データ時のパフォーマンス最適化（CosmosDB composite index）
- 検索対象の拡張（翻訳テキスト、要約テキスト）

### 必要なファイル変更一覧

| ファイル | Phase | 変更内容 |
|---------|-------|---------|
| `api/src/services/recordingService.ts` | 1 | CONTAINS を OR 条件で transcript も検索 |
| `web/src/app/history/page.tsx` | 1 | debounce、スニペット表示、検索プレースホルダー更新 |
| `web/src/app/recording/page.tsx` | 2 | ページ内検索バー、テキストハイライト |
| `web/messages/ja.json` | 1+2 | i18n キー追加 |
| `web/messages/en.json` | 1+2 | i18n キー追加 |
| `web/messages/es.json` | 1+2 | i18n キー追加 |

**新規ファイル: なし**

---

## 8. テスト戦略

### 8.1 API テスト

| テストケース | 入力 | 期待結果 |
|-------------|------|---------|
| タイトル検索 | search="定例" | title に「定例」を含む録音が返る |
| 全文検索 | search="予算" | transcript.fullText に「予算」を含む録音が返る |
| 補正版検索 | search="修正語" | correctedTranscript.fullText にマッチ |
| 複合条件 | search="keyword" + folderId="xxx" | 両条件 AND で絞込 |
| 検索ヒットなし | search="存在しない語" | items: [], total: 0 |
| 空検索 | search="" | 全件返却（既存動作） |
| 大文字小文字 | search="Hello" (data: "hello") | マッチする（LOWER 比較） |
| transcript 未設定 | search="any" (recording has no transcript) | エラーにならない |

### 8.2 フロントエンドテスト

| テストケース | 確認項目 |
|-------------|---------|
| 検索入力 → debounce | 400ms 後にのみ API 呼び出し |
| 検索結果にスニペット | transcript マッチ行のスニペットが表示 |
| ページ内検索 | マッチ箇所がハイライト |
| Prev/Next ナビ | マッチ間を移動 |
| 検索クリア | 全件表示に戻る |

### 8.3 手動テスト

| 環境 | テスト内容 |
|------|---------|
| Chrome Desktop | 全機能、debounce タイミング |
| モバイル | タッチ操作、キーボード表示時のレイアウト |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API: listRecordings に transcript 全文検索 OR 条件追加 | 15 min | recordingService.ts |
| 2 | 履歴: debounce 実装 | 20 min | history/page.tsx |
| 3 | 履歴: 検索結果スニペット表示 + ハイライト | 30 min | history/page.tsx |
| 4 | i18n キー追加（Phase 1 分） | 10 min | messages/*.json |
| 5 | Phase 1 動作確認 + ビルド + デプロイ | 30 min | - |
| 6 | 録音詳細: ページ内検索バー UI | 30 min | recording/page.tsx |
| 7 | 録音詳細: テキストハイライト + Prev/Next ナビ | 40 min | recording/page.tsx |
| 8 | i18n キー追加（Phase 2 分） | 10 min | messages/*.json |
| 9 | Phase 2 動作確認 + ビルド + デプロイ | 30 min | - |
| **合計** | | **~3.5 時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| CosmosDB RU 消費増加（全文 CONTAINS） | 高 | 中 | debounce + 検索結果キャッシュ |
| transcript が null の録音でクエリエラー | 中 | 高 | IS_DEFINED チェック or null-safe CONTAINS |
| 長文 transcript での CONTAINS 低速 | 低 | 中 | CosmosDB はドキュメント単位 scan。1000 件未満なら問題なし |
| 日本語部分一致の精度 | 低 | 低 | CONTAINS は文字列一致。形態素解析は不要 |
| debounce による UX 遅延感 | 低 | 低 | 400ms は許容範囲。ローディングインジケーター表示 |

---

## 11. 結論

- **最大の問題点**: API の検索が `c.title` のみを対象としており、`c.transcript.fullText` が完全に検索対象外。検索バーが存在するにもかかわらず、ユーザーが期待する「文字起こし内容の検索」ができない
- **推奨する修正順序**: 
  1. Phase 1: API 全文検索 OR 条件追加 + debounce（最小工数で最大効果）
  2. Phase 2: 録音詳細ページ内検索（#135 セグメント表示の後に実装）
- **他 Issue への影響**: #135（タイムコード同期）のセグメント表示基盤を活用してページ内検索ハイライトが可能
- **CosmosDB への影響**: `CONTAINS` は全文スキャンだが、個人ユーザー単位（`userId` フィルタ済み）のため現時点では問題なし。将来的にユーザーあたり数千件になった場合は別途検討
- **判定**: **`GO`** — Phase 1 は API の1行変更 + フロントの debounce 追加のみで実現可能。低リスク・高効果

---

*レビュー作成日: 2025-07-13*  
*レビュアー: @ReviewAAgent*
