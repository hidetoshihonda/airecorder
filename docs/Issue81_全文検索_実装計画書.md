# Issue #81: 全文検索（文字起こしテキスト内キーワード検索）— 実装計画書

## 概要

履歴ページで文字起こしテキスト内のキーワード検索を可能にし、録音詳細ページでページ内検索 + マッチハイライトを実装する。

## 前提条件

- 分析レビュー: `docs/Issue81_全文検索_分析レビュー.md`
- 関連 Issue: #135 (タイムコード同期 — セグメント表示基盤)
- ブロッカー: なし

---

## Phase 1: 履歴ページの全文検索

### Step 1: API — transcript.fullText を検索対象に追加

**ファイル**: `api/src/services/recordingService.ts`

**Before** (L131-134):
```typescript
if (search) {
  queryText += " AND CONTAINS(LOWER(c.title), LOWER(@search))";
  parameters.push({ name: "@search", value: search });
}
```

**After**:
```typescript
if (search) {
  queryText +=
    " AND (" +
    "CONTAINS(LOWER(c.title), LOWER(@search))" +
    " OR (IS_DEFINED(c.transcript.fullText) AND CONTAINS(LOWER(c.transcript.fullText), LOWER(@search)))" +
    " OR (IS_DEFINED(c.correctedTranscript.fullText) AND CONTAINS(LOWER(c.correctedTranscript.fullText), LOWER(@search)))" +
    ")";
  parameters.push({ name: "@search", value: search });
}
```

**ポイント**:
- `IS_DEFINED` チェックで transcript が null の録音でもクエリエラーにならない
- `correctedTranscript` も検索対象に含め、AI 補正後のテキストでもマッチ可能
- LOWER で大文字小文字を区別しない

---

### Step 2: 履歴ページに debounce 追加

**ファイル**: `web/src/app/history/page.tsx`

#### 2a. debouncedSearch state 追加

```tsx
// L62 付近の既存 state の後に追加
const [debouncedSearch, setDebouncedSearch] = useState("");
```

#### 2b. debounce useEffect 追加

```tsx
// searchQuery → debouncedSearch に 400ms debounce
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(searchQuery);
  }, 400);
  return () => clearTimeout(timer);
}, [searchQuery]);
```

#### 2c. 既存の useEffect と fetchRecordings の依存を debouncedSearch に変更

```tsx
// Before: [searchQuery, selectedFolderId, isAuthenticated, authLoading]
// After:  [debouncedSearch, selectedFolderId, isAuthenticated, authLoading]

useEffect(() => {
  if (authLoading || !isAuthenticated) {
    setIsLoading(false);
    return;
  }
  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    const response = await recordingsApi.listRecordings(
      1, 50, debouncedSearch || undefined, selectedFolderId || undefined
    );
    // ... 既存のレスポンス処理
  };
  fetchData();
}, [debouncedSearch, selectedFolderId, isAuthenticated, authLoading]);
```

```tsx
// fetchRecordings も同様に debouncedSearch を使用
const fetchRecordings = useCallback(async () => {
  if (!isAuthenticated) return;
  // ...
  const response = await recordingsApi.listRecordings(
    1, 50, debouncedSearch || undefined, selectedFolderId || undefined
  );
  // ...
}, [debouncedSearch, selectedFolderId, isAuthenticated]);
```

---

### Step 3: 検索結果にスニペット表示

**ファイル**: `web/src/app/history/page.tsx`

#### 3a. スニペット生成ヘルパー関数追加（コンポーネント外）

```tsx
function getSearchSnippet(text: string, query: string, contextChars = 40): React.ReactNode {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return null;

  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + query.length + contextChars);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  const before = text.slice(start, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length, end);

  return (
    <span>
      {prefix}{before}<mark className="bg-yellow-200 rounded px-0.5">{match}</mark>{after}{suffix}
    </span>
  );
}
```

#### 3b. 録音カード内にスニペット表示を追加

録音カードの既存メタ情報（transcribed / translated バッジ）の後に追加:

```tsx
{/* 全文検索マッチスニペット (Issue #81) */}
{debouncedSearch && recording.transcript?.fullText && (
  (() => {
    const snippet = getSearchSnippet(recording.transcript.fullText, debouncedSearch);
    return snippet ? (
      <div className="mt-2 text-xs text-gray-600 bg-yellow-50 rounded-md p-2 border border-yellow-100">
        <span className="text-yellow-700 font-medium mr-1">📝</span>
        {snippet}
      </div>
    ) : null;
  })()
)}
```

---

### Step 4: 検索プレースホルダー更新 + i18n

#### `web/messages/ja.json` — HistoryPage:

```json
// 変更
"searchPlaceholder": "タイトル・文字起こし内容で検索..."
```

#### `web/messages/en.json` — HistoryPage:

```json
// 変更
"searchPlaceholder": "Search by title or transcript content..."
```

#### `web/messages/es.json` — HistoryPage:

```json
// 変更
"searchPlaceholder": "Buscar por título o contenido de transcripción..."
```

---

## Phase 2: 録音詳細ページ内検索

> **前提**: Issue #135 のセグメント表示が実装済みであること

### Step 5: ページ内検索 state 追加

**ファイル**: `web/src/app/recording/page.tsx`

```tsx
// Issue #81: ページ内検索
const [transcriptSearch, setTranscriptSearch] = useState("");
const [searchMatchIndex, setSearchMatchIndex] = useState(0);
const [searchMatches, setSearchMatches] = useState<number[]>([]); // セグメントインデックス
const [isSearchOpen, setIsSearchOpen] = useState(false);
```

---

### Step 6: 検索バー UI（トランスクリプトタブ内）

**ファイル**: `web/src/app/recording/page.tsx`

トランスクリプト CardHeader 内に追加（自動追従トグルの隣）:

```tsx
{/* Issue #81: ページ内検索 */}
{displayTranscript?.fullText && (
  <div className="flex items-center gap-1">
    {isSearchOpen ? (
      <div className="flex items-center gap-1 rounded-md border px-2 py-1">
        <Search className="h-3.5 w-3.5 text-gray-400" />
        <input
          type="text"
          className="w-32 sm:w-48 border-0 bg-transparent text-sm focus:outline-none"
          placeholder={t("searchInTranscript")}
          value={transcriptSearch}
          onChange={(e) => setTranscriptSearch(e.target.value)}
          autoFocus
        />
        {transcriptSearch && searchMatches.length > 0 && (
          <span className="text-xs text-gray-500 tabular-nums">
            {searchMatchIndex + 1}/{searchMatches.length}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => setSearchMatchIndex((prev) =>
            prev > 0 ? prev - 1 : searchMatches.length - 1
          )}
          disabled={searchMatches.length === 0}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => setSearchMatchIndex((prev) =>
            prev < searchMatches.length - 1 ? prev + 1 : 0
          )}
          disabled={searchMatches.length === 0}
        >
          ↓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => {
            setIsSearchOpen(false);
            setTranscriptSearch("");
            setSearchMatches([]);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsSearchOpen(true)}
        className="gap-1 text-xs"
      >
        <Search className="h-3.5 w-3.5" />
        {t("searchInTranscript")}
      </Button>
    )}
  </div>
)}
```

---

### Step 7: マッチ計算 + ハイライト

**ファイル**: `web/src/app/recording/page.tsx`

```tsx
// マッチするセグメントインデックスの計算
useEffect(() => {
  if (!transcriptSearch || !displayTranscript?.segments) {
    setSearchMatches([]);
    setSearchMatchIndex(0);
    return;
  }

  const query = transcriptSearch.toLowerCase();
  const matches = displayTranscript.segments
    .map((seg, idx) => seg.text.toLowerCase().includes(query) ? idx : -1)
    .filter((idx) => idx !== -1);

  setSearchMatches(matches);
  setSearchMatchIndex(0);
}, [transcriptSearch, displayTranscript]);

// マッチセグメントへの自動スクロール
useEffect(() => {
  if (searchMatches.length === 0 || !displayTranscript?.segments) return;

  const segIndex = searchMatches[searchMatchIndex];
  const segment = displayTranscript.segments[segIndex];
  if (segment) {
    const el = segmentRefs.current.get(segment.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}, [searchMatchIndex, searchMatches, displayTranscript]);
```

#### テキストハイライト関数:

```tsx
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
    ) : (
      part
    )
  );
}
```

セグメント表示内で使用:

```tsx
// Before (from #135):
<span className="text-sm text-gray-800 leading-relaxed">
  {segment.text}
</span>

// After:
<span className="text-sm text-gray-800 leading-relaxed">
  {transcriptSearch ? highlightText(segment.text, transcriptSearch) : segment.text}
</span>
```

---

### Step 8: キーボードショートカット

```tsx
// Ctrl+F でページ内検索を開く
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      // トランスクリプトタブがアクティブな場合のみ
      if (displayTranscript?.fullText) {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    }
    if (e.key === "Escape" && isSearchOpen) {
      setIsSearchOpen(false);
      setTranscriptSearch("");
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [displayTranscript, isSearchOpen]);
```

---

### Step 9: Phase 2 の i18n キー追加

#### `web/messages/ja.json` — RecordingDetail に追加:

```json
"searchInTranscript": "テキスト内検索"
```

#### `web/messages/en.json` — RecordingDetail に追加:

```json
"searchInTranscript": "Search in text"
```

#### `web/messages/es.json` — RecordingDetail に追加:

```json
"searchInTranscript": "Buscar en texto"
```

---

## 変更ファイル一覧

| ファイル | Phase | 変更内容 |
|---------|-------|---------|
| `api/src/services/recordingService.ts` | 1 | CONTAINS を OR 条件で transcript + correctedTranscript も検索 |
| `web/src/app/history/page.tsx` | 1 | debounce、スニペット表示、getSearchSnippet ヘルパー |
| `web/src/app/recording/page.tsx` | 2 | ページ内検索バー、ハイライト、Prev/Next ナビ、Ctrl+F |
| `web/messages/ja.json` | 1+2 | searchPlaceholder 変更 + searchInTranscript 追加 |
| `web/messages/en.json` | 1+2 | 同上 |
| `web/messages/es.json` | 1+2 | 同上 |

**新規ファイル: なし**

---

## 受入基準チェックリスト

### Phase 1
- [ ] 履歴ページの検索で、タイトルだけでなく文字起こし内容もヒットする
- [ ] 検索に debounce が効いている（キーストローク毎の API 呼び出しなし）
- [ ] 文字起こしがマッチした場合、スニペット（前後文脈 + ハイライト）が表示される
- [ ] transcript が null の録音でもエラーにならない
- [ ] フォルダフィルタとの複合検索が正常に動作する
- [ ] 検索プレースホルダーが「タイトル・文字起こし内容で検索」に更新されている

### Phase 2
- [ ] 録音詳細ページでテキスト内検索バーが使える
- [ ] マッチ箇所が黄色ハイライトで表示される
- [ ] Prev/Next ボタンでマッチ間を移動できる
- [ ] Ctrl+F でアプリ内検索にフォーカスする
- [ ] ESC で検索バーが閉じる
- [ ] 多言語対応（ja/en/es）

---

## デプロイ手順

```bash
# Phase 1
git checkout -b feat/issue-81-fulltext-search
# API + 履歴ページの変更を実装
cd web && npm run build
cd ../api && npm run build
git add -A
git commit -m "feat: add full-text search across title and transcript (#81)"
git push origin feat/issue-81-fulltext-search
# PR → マージ → 自動デプロイ

# Phase 2（#135 マージ後）
git checkout -b feat/issue-81-page-search
# 録音詳細ページの変更を実装
cd web && npm run build
git add -A
git commit -m "feat: add in-page transcript search with highlight (#81)"
git push origin feat/issue-81-page-search
# PR → マージ → 自動デプロイ
```

---

## 推奨実装順序

```
#135 タイムコード同期 (Phase 1-2)
    ↓ マージ
#81 Phase 1: API全文検索 + 履歴debounce + スニペット
    ↓ マージ
#81 Phase 2: ページ内検索 + ハイライト (#135 のセグメント表示基盤を活用)
```

---

*実装計画書作成日: 2025-07-13*  
*作成者: @ReviewAAgent*
