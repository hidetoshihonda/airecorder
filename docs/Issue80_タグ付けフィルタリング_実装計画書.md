# Issue #80: 録音データへのタグ付けフィルタリング機能 — 実装計画書

## 概要

録音データに自由タグを付与し、タグによるフィルタリングで目的の録音を素早く見つけられるようにする。

### 前提条件
- `Recording.tags?: string[]` は API/Web 双方のモデルに **定義済み**
- `UpdateRecordingRequest.tags?: string[]` も **定義済み**
- `updateRecording` API で tags 保存は **既に動作可能**

### 実装が必要な箇所
1. API: `listRecordings` にタグフィルタパラメータ追加
2. フロントエンド API クライアント: `listRecordings` にタグ引数追加
3. 録音詳細ページ: タグ表示・追加・削除 UI
4. 履歴ページ: タグフィルタ UI + 録音カードへのタグ表示
5. i18n メッセージ追加（3言語）

---

## Step 1: API — listRecordings にタグフィルタ追加

### 1.1 `api/src/models/recording.ts` — ListRecordingsQuery

```typescript
export interface ListRecordingsQuery {
  userId: string;
  page?: number;
  limit?: number;
  folderId?: string;
  search?: string;
  tag?: string;       // ← 追加
}
```

### 1.2 `api/src/services/recordingService.ts` — listRecordings

`folderId` フィルタの後に追加:

```typescript
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string,
  tag?: string           // ← 追加
): Promise<PaginatedResponse<Recording>> {
  const container = await getRecordingsContainer();

  let queryText = "SELECT * FROM c WHERE c.userId = @userId";
  const parameters: Array<{ name: string; value: string | number }> = [
    { name: "@userId", value: userId },
  ];

  if (search) {
    queryText +=
      " AND (" +
      "CONTAINS(LOWER(c.title), LOWER(@search))" +
      " OR (IS_DEFINED(c.transcript.fullText) AND CONTAINS(LOWER(c.transcript.fullText), LOWER(@search)))" +
      " OR (IS_DEFINED(c.correctedTranscript.fullText) AND CONTAINS(LOWER(c.correctedTranscript.fullText), LOWER(@search)))" +
      ")";
    parameters.push({ name: "@search", value: search });
  }

  if (folderId) {
    queryText += " AND c.folderId = @folderId";
    parameters.push({ name: "@folderId", value: folderId });
  }

  // ★ Issue #80: タグフィルタ
  if (tag) {
    queryText += " AND ARRAY_CONTAINS(c.tags, @tag)";
    parameters.push({ name: "@tag", value: tag });
  }

  queryText += " ORDER BY c.createdAt DESC";

  // ... 以降は既存コード通り
}
```

### 1.3 `api/src/functions/recordings.ts` — listRecordings ハンドラ

```typescript
const tag = request.query.get("tag") || undefined;

const result = await listRecordings(userId, page, limit, search, folderId, tag);
```

---

## Step 2: フロントエンド API クライアント拡張

### `web/src/services/recordingsApi.ts` — listRecordings

```typescript
async listRecordings(
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string,
  tag?: string           // ← 追加
): Promise<ApiResponse<PaginatedResponse<Recording>>> {
  const authError = this.requireAuth<PaginatedResponse<Recording>>();
  if (authError) return authError;

  const params = new URLSearchParams({
    userId: this.userId!,
    page: page.toString(),
    limit: limit.toString(),
  });

  if (search) {
    params.append("search", search);
  }

  if (folderId) {
    params.append("folderId", folderId);
  }

  // ★ Issue #80: タグフィルタ
  if (tag) {
    params.append("tag", tag);
  }

  return this.request<PaginatedResponse<Recording>>(
    `/recordings/list?${params.toString()}`
  );
}
```

---

## Step 3: 録音詳細ページ — タグ編集 UI

### `web/src/app/recording/page.tsx`

#### 3.1 インポート追加

```typescript
import { Tag } from "lucide-react";
```

#### 3.2 state 追加（既存 state 群の近くに追加）

```typescript
const [newTag, setNewTag] = useState("");
const [isUpdatingTags, setIsUpdatingTags] = useState(false);
```

#### 3.3 タグ追加・削除ハンドラ

```typescript
// タグ追加 (Issue #80)
const handleAddTag = async (e: React.FormEvent) => {
  e.preventDefault();
  const tagValue = newTag.trim().toLowerCase();
  if (!tagValue || !recording) return;
  
  const currentTags = recording.tags || [];
  if (currentTags.includes(tagValue)) {
    setNewTag("");
    return; // 重複排除
  }
  if (currentTags.length >= 10) return; // 上限

  const updatedTags = [...currentTags, tagValue];
  setIsUpdatingTags(true);
  
  const response = await recordingsApi.updateRecording(recording.id, {
    tags: updatedTags,
  });
  
  if (response.data) {
    setRecording(response.data);
  }
  setNewTag("");
  setIsUpdatingTags(false);
};

// タグ削除 (Issue #80)
const handleRemoveTag = async (tagToRemove: string) => {
  if (!recording) return;
  
  const updatedTags = (recording.tags || []).filter((t) => t !== tagToRemove);
  setIsUpdatingTags(true);
  
  const response = await recordingsApi.updateRecording(recording.id, {
    tags: updatedTags,
  });
  
  if (response.data) {
    setRecording(response.data);
  }
  setIsUpdatingTags(false);
};
```

#### 3.4 UI（メタ情報セクション L783 の `</div>` 直前に追加）

L771-783 の言語バッジの後、`</div>` の前に挿入:

```tsx
        {/* Tags (Issue #80) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag className="h-4 w-4 text-gray-400 flex-shrink-0" />
          {recording.tags?.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-0.5 rounded-full text-blue-500 hover:text-blue-800 focus:outline-none"
                disabled={isUpdatingTags}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <form onSubmit={handleAddTag} className="inline-flex items-center">
            <Input
              type="text"
              placeholder={t("addTagPlaceholder")}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="h-6 w-32 text-xs px-2"
              maxLength={30}
              disabled={isUpdatingTags}
            />
          </form>
          {isUpdatingTags && <Spinner size="sm" />}
        </div>
```

---

## Step 4: 履歴ページ — タグフィルタ UI

### `web/src/app/history/page.tsx`

#### 4.1 インポート追加

```typescript
import { Tag } from "lucide-react";
```

#### 4.2 state 追加

```typescript
const [selectedTag, setSelectedTag] = useState<string | null>(null);
```

#### 4.3 allTags の算出（useMemo）

```typescript
// 全録音から使用中のタグ一覧を集計 (Issue #80)
const allTags = useMemo(() => {
  const tagSet = new Set<string>();
  recordings.forEach((r) => {
    r.tags?.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}, [recordings]);
```

※ `useMemo` を import に追加する必要あり。

#### 4.4 listRecordings 呼び出しにタグパラメータ追加

fetchData と fetchRecordings の両方:

```typescript
const response = await recordingsApi.listRecordings(
  1,
  50,
  debouncedSearch || undefined,
  selectedFolderId || undefined,
  selectedTag || undefined        // ← 追加
);
```

useEffect の依存配列にも `selectedTag` を追加:

```typescript
}, [debouncedSearch, selectedFolderId, selectedTag, isAuthenticated, authLoading]);
```

fetchRecordings の useCallback 依存配列にも追加:

```typescript
}, [debouncedSearch, selectedFolderId, selectedTag, isAuthenticated]);
```

#### 4.5 タグフィルタ UI（検索バーの上 or フォルダタブの下に配置）

フォルダタブの下、検索の上に挿入:

```tsx
      {/* Tag Filter (Issue #80) */}
      {allTags.length > 0 && (
        <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
          <Tag className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <button
            onClick={() => setSelectedTag(null)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedTag === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t("allTags")}
          </button>
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

#### 4.6 録音カードにタグチップ表示

既存の status バッジ（`transcribed`, `translated`, `minutesCreated`）の後に追加:

```tsx
                        {/* Tags (Issue #80) */}
                        {recording.tags && recording.tags.length > 0 && (
                          recording.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                            >
                              {tag}
                            </span>
                          ))
                        )}
```

---

## Step 5: i18n メッセージ追加

### `web/messages/ja.json`

RecordingDetail セクション:
```json
"addTagPlaceholder": "タグを追加..."
```

HistoryPage セクション:
```json
"allTags": "全タグ"
```

### `web/messages/en.json`

RecordingDetail セクション:
```json
"addTagPlaceholder": "Add tag..."
```

HistoryPage セクション:
```json
"allTags": "All Tags"
```

### `web/messages/es.json`

RecordingDetail セクション:
```json
"addTagPlaceholder": "Agregar etiqueta..."
```

HistoryPage セクション:
```json
"allTags": "Todas las etiquetas"
```

---

## Step 6: ビルド確認

```bash
cd api && npm run build
cd web && npm run build
```

---

## Step 7: コミット・PR・デプロイ

```bash
git checkout -b feature/issue-80-tag-filtering
git add -A
git commit -m "feat: add tag filtering for recordings (Issue #80)"
git push origin feature/issue-80-tag-filtering
gh pr create --title "feat: 録音データへのタグ付けフィルタリング機能 (Issue #80)"
```

---

## 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `api/src/models/recording.ts` | 変更 | ListRecordingsQuery に `tag` 追加 |
| `api/src/services/recordingService.ts` | 変更 | listRecordings に `tag` パラメータ + ARRAY_CONTAINS クエリ追加 |
| `api/src/functions/recordings.ts` | 変更 | tag クエリパラメータ取得 |
| `web/src/services/recordingsApi.ts` | 変更 | listRecordings に `tag` 引数追加 |
| `web/src/app/recording/page.tsx` | 変更 | タグ表示・追加・削除 UI |
| `web/src/app/history/page.tsx` | 変更 | タグフィルタ UI + 録音カードへのタグ表示 |
| `web/messages/ja.json` | 変更 | i18n キー追加 |
| `web/messages/en.json` | 変更 | i18n キー追加 |
| `web/messages/es.json` | 変更 | i18n キー追加 |

**合計**: 9ファイル変更、新規ファイルなし
