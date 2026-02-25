# Issue #171: タグの再利用ができない — 実装計画書

## 概要

タグ入力UIにサジェスト/オートコンプリート機能を追加し、既存タグを選択して再利用できるようにする。

---

## 変更対象ファイル一覧

| # | ファイル | 変更種別 | 内容 |
|---|---------|---------|------|
| 1 | `api/src/services/recordingService.ts` | 関数追加 | `getUserTags()` 関数 |
| 2 | `api/src/functions/recordings.ts` | エンドポイント追加 | `GET /recordings/tags` |
| 3 | `web/src/services/recordingsApi.ts` | メソッド追加 | `listUserTags()` |
| 4 | `web/src/app/recording/page.tsx` | UI改修 | タグサジェストUI追加 |
| 5 | `web/src/app/history/page.tsx` | ロジック改善 | `allTags` をAPI取得に変更 |

---

## Step 1: API — `getUserTags()` サービス関数追加

**ファイル**: `api/src/services/recordingService.ts`

**場所**: ファイル末尾（`saveRecordingWithAudio` 関数の後）

**追加コード**:

```typescript
/**
 * ユーザーが使用している全タグの一覧を取得 (Issue #171)
 */
export async function getUserTags(userId: string): Promise<string[]> {
  const container = await getRecordingsContainer();

  const { resources } = await container.items
    .query<string>({
      query:
        "SELECT DISTINCT VALUE tag FROM c JOIN tag IN c.tags WHERE c.userId = @userId",
      parameters: [{ name: "@userId", value: userId }],
    })
    .fetchAll();

  return resources.sort();
}
```

**補足**: 
- CosmosDB の `JOIN` + `DISTINCT VALUE` を使い、全録音の `tags` 配列をフラット化して一意なタグのみを返す
- `sort()` でアルファベット順に返す

---

## Step 2: API — `GET /recordings/tags` エンドポイント追加

**ファイル**: `api/src/functions/recordings.ts`

**場所**: `listRecordings` エンドポイントの直後に追加

**追加コード**:

```typescript
// List user tags (Issue #171)
app.http("listUserTags", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/tags",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const userId = request.query.get("userId");
      if (!userId) {
        return jsonResponse(
          { success: false, error: "userId is required" },
          400
        );
      }

      const tags = await getUserTags(userId);
      return jsonResponse<string[]>({
        success: true,
        data: tags,
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

**注意**: import に `getUserTags` を追加すること。

```typescript
import {
  createRecording,
  getRecording,
  updateRecording,
  deleteRecording,
  listRecordings,
  getUserTags,  // ← 追加
} from "../services/recordingService";
```

**ルート登録順序**: `recordings/tags` は `recordings/{id}` より**前**に登録する必要がある（Azure Functions のルートマッチング順序）。`recordings/list` の直後に配置することで確実に動作する。

---

## Step 3: Web — `listUserTags()` メソッド追加

**ファイル**: `web/src/services/recordingsApi.ts`

**場所**: `listRecordings()` メソッドの直後に追加

**追加コード**:

```typescript
/**
 * ユーザーの全タグ一覧を取得 (Issue #171)
 */
async listUserTags(): Promise<ApiResponse<string[]>> {
  const authError = this.requireAuth<string[]>();
  if (authError) return authError;

  const params = new URLSearchParams({ userId: this.userId! });
  return this.request<string[]>(
    `/recordings/tags?${params.toString()}`
  );
}
```

---

## Step 4: Web — 録音詳細ページにタグサジェストUI追加

**ファイル**: `web/src/app/recording/page.tsx`

### 4.1 state 追加

**場所**: L136-137 の既存タグ state の直後

```tsx
// Tag editing state (Issue #80)
const [newTag, setNewTag] = useState("");
const [isUpdatingTags, setIsUpdatingTags] = useState(false);
// Tag suggestion state (Issue #171)
const [availableTags, setAvailableTags] = useState<string[]>([]);
const [showTagSuggestions, setShowTagSuggestions] = useState(false);
```

### 4.2 タグ一覧取得 useEffect 追加

**場所**: 既存の useEffect 群の近くに追加

```tsx
// Issue #171: ユーザーの全タグ一覧を取得
useEffect(() => {
  const fetchUserTags = async () => {
    const response = await recordingsApi.listUserTags();
    if (response.data) {
      setAvailableTags(response.data);
    }
  };
  fetchUserTags();
}, []);
```

### 4.3 フィルタ済みサジェスト useMemo 追加

```tsx
// Issue #171: タグサジェスト候補（既に付いているタグを除外＆入力値でフィルタ）
const filteredTagSuggestions = useMemo(() => {
  const currentTags = recording?.tags || [];
  return availableTags
    .filter((tag) => !currentTags.includes(tag))
    .filter((tag) => !newTag || tag.includes(newTag.toLowerCase()));
}, [availableTags, newTag, recording?.tags]);
```

### 4.4 サジェスト選択ハンドラ追加

```tsx
// Issue #171: サジェストからタグを選択
const handleSelectTagSuggestion = async (tag: string) => {
  if (!recording || !id) return;
  const currentTags = recording.tags || [];
  if (currentTags.includes(tag) || currentTags.length >= 10) return;

  const updatedTags = [...currentTags, tag];
  setIsUpdatingTags(true);
  setShowTagSuggestions(false);
  setNewTag("");

  const response = await recordingsApi.updateRecording(id, {
    tags: updatedTags,
  });

  if (response.data) {
    setRecording(response.data);
  }
  setIsUpdatingTags(false);
};
```

### 4.5 タグ追加成功時に availableTags を更新

`handleAddTag` 関数の末尾に追加:

```tsx
// Issue #171: 新規タグをサジェスト候補に追加
if (!availableTags.includes(tagValue)) {
  setAvailableTags((prev) => [...prev, tagValue].sort());
}
```

### 4.6 タグ入力 UI をサジェスト付きに変更

**場所**: L907-L926 のタグ入力 form を以下に置換

```tsx
<form onSubmit={handleAddTag} className="relative inline-flex items-center">
  <Input
    type="text"
    placeholder={t("addTagPlaceholder")}
    value={newTag}
    onChange={(e) => {
      setNewTag(e.target.value);
      setShowTagSuggestions(true);
    }}
    onFocus={() => setShowTagSuggestions(true)}
    onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
    className="h-6 w-32 text-xs px-2"
    maxLength={30}
    disabled={isUpdatingTags}
  />
  {/* Issue #171: タグサジェストドロップダウン */}
  {showTagSuggestions && filteredTagSuggestions.length > 0 && (
    <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-md border bg-white shadow-lg max-h-40 overflow-y-auto">
      {filteredTagSuggestions.map((tag) => (
        <button
          key={tag}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleSelectTagSuggestion(tag)}
          className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700"
        >
          {tag}
        </button>
      ))}
    </div>
  )}
</form>
```

**ポイント**:
- `onMouseDown={(e) => e.preventDefault()}` で候補クリック時にフォーカスアウトを防止
- `onBlur` で `setTimeout(200ms)` を使い、候補クリック前に閉じることを防止
- `z-50` で他の要素に被らないようにする

---

## Step 5: Web — 履歴ページの `allTags` をAPI取得に変更

**ファイル**: `web/src/app/history/page.tsx`

### 5.1 state 追加

**場所**: L64 付近の既存 state に追加

```tsx
// Issue #80: タグフィルタ
const [selectedTag, setSelectedTag] = useState<string | null>(null);
// Issue #171: 全タグ一覧（API取得）
const [allTags, setAllTags] = useState<string[]>([]);
```

### 5.2 既存の `allTags` useMemo を削除

**場所**: L206-L212 の以下を**削除**

```tsx
// ★削除対象
const allTags = useMemo(() => {
  const tagSet = new Set<string>();
  recordings.forEach((r) => {
    r.tags?.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}, [recordings]);
```

### 5.3 タグ一覧取得 useEffect 追加

**場所**: フォルダ一覧取得の useEffect 近くに追加

```tsx
// Issue #171: 全タグ一覧をAPI経由で取得
useEffect(() => {
  if (!isAuthenticated) return;
  const fetchTags = async () => {
    const response = await recordingsApi.listUserTags();
    if (response.data) {
      setAllTags(response.data);
    }
  };
  fetchTags();
}, [isAuthenticated]);
```

---

## テスト確認項目

| # | テスト内容 | 合否基準 |
|---|-----------|---------|
| 1 | API: `GET /recordings/tags?userId=xxx` | ユーザーの全タグが重複なしで返る |
| 2 | タグ入力欄をクリック | 既存タグがドロップダウンで表示される |
| 3 | 文字入力中のフィルタ | 入力文字を含むタグのみが候補に表示される |
| 4 | 候補をクリック | タグが追加され、入力欄がクリアされる |
| 5 | 既存タグの除外 | 既に付いているタグは候補に表示されない |
| 6 | 新規タグの手入力 | Enter で新規タグが追加される（従来動作） |
| 7 | 履歴ページのタグフィルタ | 全タグがフィルタ選択肢に表示される |
| 8 | タグ上限（10個） | 10個に達したら候補もフォームも無効化 |

---

## 実装順序

1. **Step 1 + 2**: API 側（サービス + エンドポイント）— 先に完成させてデプロイ
2. **Step 3**: Web API サービスメソッド追加
3. **Step 4**: 録音詳細ページのサジェストUI
4. **Step 5**: 履歴ページのタグフィルタ改善
5. **テスト・動作確認**

**推定作業時間**: 約2時間
