# Issue #171: タグの再利用ができない（毎回新規作成が必要） — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: タグ入力UIがフリーテキスト入力のみで、既存タグのサジェスト・選択機能が一切ない。そのため「タグの再利用」が事実上不可能であり、ユーザーは毎回手入力で同一タグ名を打ち直す必要がある。
- **影響範囲**: タグ機能を使う全ユーザー（100%）に影響。タグの分類・フィルタリングの実用性が著しく低下。
- **修正の緊急度**: **P1 — High**。タグ機能の根幹を損なうUXバグ。データモデル変更は不要、フロントエンド修正のみで解決可能。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
[録音詳細ページ]               [履歴ページ]
web/src/app/recording/page.tsx  web/src/app/history/page.tsx
        │                              │
        │ handleAddTag()               │ allTags (useMemo - 現在ページの録音から集計)
        │ handleRemoveTag()            │ selectedTag (フィルタ用)
        ▼                              ▼
  recordingsApi.updateRecording()  recordingsApi.listRecordings(tag?)
        │                              │
        ▼                              ▼
  API: PUT /recordings/{id}       API: GET /recordings/list?tag=xxx
        │                              │
        ▼                              ▼
  recordingService.updateRecording()  recordingService.listRecordings()
        │                              │
        ▼                              ▼
  CosmosDB: recordings container (tags: string[])
```

### 2.2 データフロー（タグ追加の現在の流れ）

```
ユーザー入力 → newTag state → handleAddTag() → toLowerCase/trim
    → 重複チェック（現在の録音内のみ）
    → recordingsApi.updateRecording({ tags: [...currentTags, tagValue] })
    → API: PUT /recordings/{id}
    → CosmosDB update
    → レスポンスで recording state 更新
```

### 2.3 データモデル

| フィールド | 型 | 場所 |
|-----------|------|------|
| `recording.tags` | `string[]` (optional) | CosmosDB recording ドキュメント |

タグは**独立エンティティではなく**、各 recording ドキュメントの配列フィールドとして格納されている。タグマスターは存在しない。

---

## 3. 重大バグ分析 🔴

### BUG-1: タグ入力にサジェスト/オートコンプリートが存在しない

**場所**: [web/src/app/recording/page.tsx](web/src/app/recording/page.tsx#L907-L926)

**コード**:
```tsx
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
```

**問題**: テキスト入力フィールドのみで、既存タグのドロップダウン/サジェストが一切ない。ユーザーは過去に作成したタグを**覚えていて正確にタイプ**しなければ再利用できない。

**影響**: 
- タグの再利用率が極端に低下（ユーザーは過去タグを記憶していない）
- タグ名の表記揺れが多発（例: "会議" vs "ミーティング" vs "meeting"）
- タグ分類・フィルタリング機能の実効性が大幅に低下

**根本原因**: Issue #80 でタグ機能が初期実装された際、最小機能（MVP）としてフリーテキスト入力のみで実装された。サジェスト機能は設計に含まれていなかった。

**重要度**: 🔴 **Critical**

**修正方針**: 
1. ユーザーの全録音から使用中タグを集計する API エンドポイント `GET /recordings/tags` を新設
2. 録音詳細ページのタグ入力フィールドに、入力中の文字で既存タグをフィルタリングするサジェスト候補ドロップダウンを追加
3. サジェスト候補クリックでタグ追加（新規テキスト入力も従来通り可能）

---

### BUG-2: 履歴ページの `allTags` が現在取得済み録音のみに限定されている

**場所**: [web/src/app/history/page.tsx](web/src/app/history/page.tsx#L206-L212)

**コード**:
```tsx
const allTags = useMemo(() => {
  const tagSet = new Set<string>();
  recordings.forEach((r) => {
    r.tags?.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}, [recordings]);
```

**問題**: `recordings` はページネーション済み（limit=50）で取得されるため、50件を超える録音がある場合、一部のタグが `allTags` に含まれない。タグフィルタで「存在するはずのタグ」が表示されないケースが発生する。

**影響**: 録音が50件を超えるユーザー（ヘビーユーザー）のタグフィルタが不完全になる。

**根本原因**: タグ一覧を取得する専用APIが存在せず、フロントエンドで「取得済み録音」からクライアントサイド集計している。

**重要度**: 🟡 **Medium**

**修正方針**: 専用 API `GET /recordings/tags` でユーザーの全タグを返す。CosmosDB の `SELECT DISTINCT VALUE tag FROM c JOIN tag IN c.tags WHERE c.userId = @userId` で効率的に取得可能。

---

## 4. 設計上の問題 🟡

### DESIGN-1: タグのマスター管理不在

**問題**: タグは recording.tags に文字列配列として埋め込まれており、タグ自体のマスターテーブル/ドキュメントが存在しない。

**影響**:
- 全タグ一覧の取得に全録音ドキュメントのスキャンが必要
- タグ名の正規化（大文字小文字、空白）がクライアント依存
- タグの使用回数集計に全件集計が必要

**現時点の判断**: 現在のユーザー規模では `SELECT DISTINCT` クエリで十分対応可能。タグマスターテーブルの導入は将来の拡張（タグ色、タグ説明文など）が必要になった段階で検討。

✅ **Good**: `handleAddTag` で `toLowerCase()` による正規化を実施済み。

### DESIGN-2: 録音作成時のタグ入力フローがない

**問題**: 録音保存ダイアログではタイトルのみ入力でき、タグは録音詳細画面でしか追加できない。

**影響**: ユーザーが録音保存時にタグ付けする自然なワークフローが存在しない。後から詳細画面を開いてタグ付けするフローは煩雑。

**現時点の判断**: Issue #171 のスコープとしては、既存の録音詳細ページでのタグ再利用を解決することが優先。保存ダイアログへのタグ入力追加は別 Issue で対応可。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #171 (タグ再利用) ─── 独立して修正可能（他 Issue への依存なし）
      │
      └──→ Issue #80 (タグ機能の初期実装) — 基盤として依存（既に完了）
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| タグサジェストUI | 新規 API `GET /recordings/tags` | 低 — 新規エンドポイント追加のみ | APIとフロントを並行開発可 |
| 録音詳細ページ | `recordingsApi` サービス | 低 — 既存パターンに従う | メソッド追加のみ |
| CosmosDB クエリ | CosmosDB JOIN + DISTINCT | 低 — CosmosDB が対応 | クエリ性能テストを実施 |

### 5.3 他 Issue/機能との相互作用

- **Issue #80（タグ機能）**: 本 Issue はその改善。後方互換性あり。
- **履歴ページのタグフィルタ**: `allTags` の改善により恩恵を受ける。

---

## 6. ブラウザ / 環境互換性リスク

該当なし。フロントエンドの UI コンポーネント変更のみで、特殊な Web API は使用しない。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）— タグサジェスト機能の追加

#### 7.1.1 API: ユーザータグ一覧取得エンドポイント

**新規ファイル**: なし（既存ファイルに追加）

**変更ファイル**: 
- `api/src/services/recordingService.ts` — `getUserTags()` 関数追加
- `api/src/functions/recordings.ts` — `GET /recordings/tags` エンドポイント追加
- `web/src/services/recordingsApi.ts` — `listUserTags()` メソッド追加

```typescript
// api/src/services/recordingService.ts に追加
export async function getUserTags(userId: string): Promise<string[]> {
  const container = await getRecordingsContainer();
  const { resources } = await container.items
    .query<{ tag: string }>({
      query: "SELECT DISTINCT VALUE tag FROM c JOIN tag IN c.tags WHERE c.userId = @userId",
      parameters: [{ name: "@userId", value: userId }],
    })
    .fetchAll();
  return resources.sort();
}
```

```typescript
// api/src/functions/recordings.ts に追加
app.http("listUserTags", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/tags",
  handler: async (request, _context) => {
    if (request.method === "OPTIONS") return jsonResponse({ success: true });
    const userId = request.query.get("userId");
    if (!userId) return jsonResponse({ success: false, error: "userId is required" }, 400);
    const tags = await getUserTags(userId);
    return jsonResponse({ success: true, data: tags });
  },
});
```

```typescript
// web/src/services/recordingsApi.ts に追加
async listUserTags(): Promise<ApiResponse<string[]>> {
  const authError = this.requireAuth<string[]>();
  if (authError) return authError;
  const params = new URLSearchParams({ userId: this.userId! });
  return this.request<string[]>(`/recordings/tags?${params.toString()}`);
}
```

#### 7.1.2 フロントエンド: タグ入力にサジェストドロップダウン追加

**変更ファイル**: `web/src/app/recording/page.tsx`

**修正概要**:
1. `useEffect` で `recordingsApi.listUserTags()` を呼び、`availableTags` state にセット
2. `newTag` の入力値変化時に `availableTags` をフィルタリングして候補を表示
3. 候補クリックでタグ追加
4. 既に付いているタグは候補から除外

```tsx
// 新しい state
const [availableTags, setAvailableTags] = useState<string[]>([]);
const [showSuggestions, setShowSuggestions] = useState(false);

// 初回ロード時に取得
useEffect(() => {
  const fetchTags = async () => {
    const response = await recordingsApi.listUserTags();
    if (response.data) setAvailableTags(response.data);
  };
  fetchTags();
}, []);

// フィルタ済みサジェスト
const filteredSuggestions = useMemo(() => {
  const currentTags = recording?.tags || [];
  return availableTags
    .filter(tag => !currentTags.includes(tag))
    .filter(tag => !newTag || tag.includes(newTag.toLowerCase()));
}, [availableTags, newTag, recording?.tags]);
```

UIイメージ:
```tsx
<div className="relative">
  <Input
    type="text"
    value={newTag}
    onChange={(e) => { setNewTag(e.target.value); setShowSuggestions(true); }}
    onFocus={() => setShowSuggestions(true)}
    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
    ...
  />
  {showSuggestions && filteredSuggestions.length > 0 && (
    <div className="absolute top-full left-0 z-10 mt-1 w-48 bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
      {filteredSuggestions.map((tag) => (
        <button key={tag} onClick={() => handleSelectSuggestion(tag)} className="...">
          {tag}
        </button>
      ))}
    </div>
  )}
</div>
```

### Phase 2: 設計改善（P1）— 履歴ページのタグフィルタ改善

**変更ファイル**: `web/src/app/history/page.tsx`

**修正概要**: 
- `allTags` を `recordings` からの `useMemo` 集計ではなく、`listUserTags()` API を使って全タグを取得するよう変更

```tsx
const [allTags, setAllTags] = useState<string[]>([]);

useEffect(() => {
  if (!isAuthenticated) return;
  const fetchTags = async () => {
    const response = await recordingsApi.listUserTags();
    if (response.data) setAllTags(response.data);
  };
  fetchTags();
}, [isAuthenticated]);
```

### Phase 3: 堅牢性強化（P2）

- タグ追加成功時に `availableTags` を自動更新（API再取得 or ローカル追加）
- タグ削除時、他の録音で未使用になったタグを `availableTags` から除外（次回 API 取得時に自動反映）
- キーボードナビゲーション対応（↑↓キーでサジェスト候補選択、Enter で確定）

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| ケース | 入力 | 期待結果 |
|--------|------|---------|
| サジェスト表示 | タグ入力フィールドフォーカス | 既存タグの候補ドロップダウンが表示される |
| 入力フィルタ | "会" と入力 | "会議" タグのみがサジェストされる |
| 既存タグ除外 | 録音に "会議" タグが付いている | サジェストから "会議" が除外される |
| サジェスト選択 | 候補 "会議" をクリック | 録音に "会議" タグが追加される |
| 新規タグ入力 | 新しい文字列を入力して Enter | 新規タグが追加される（従来通り） |
| 上限チェック | 10個タグがある状態で追加 | 追加が拒否される |

### 統合テスト

| シナリオ | テスト内容 |
|---------|-----------|
| API: タグ一覧取得 | `GET /recordings/tags` が全タグを重複なしで返す |
| クロスページ連携 | 録音Aでタグ追加 → 録音Bで同タグがサジェストに表示される |
| 履歴フィルタ | 全タグが正しくフィルタ選択肢に表示される |

### 手動テスト

| 操作 | 確認ポイント |
|------|-------------|
| タグ入力欄をクリック | 既存タグが候補として表示 |
| 文字入力中 | リアルタイムでフィルタリング |
| 候補をクリック | タグが追加され、サジェストから消える |
| ブラウザリロード後 | サジェストが正しく表示される |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API: `getUserTags()` サービス関数追加 | 15分 | `recordingService.ts` |
| 2 | API: `GET /recordings/tags` エンドポイント追加 | 15分 | `recordings.ts` |
| 3 | Web: `recordingsApi.listUserTags()` メソッド追加 | 10分 | `recordingsApi.ts` |
| 4 | Web: 録音詳細ページにサジェストUI追加 | 45分 | `recording/page.tsx` |
| 5 | Web: 履歴ページの `allTags` をAPI取得に変更 | 15分 | `history/page.tsx` |
| 6 | テスト・動作確認 | 30分 | 全体 |
| **合計** | | **約2時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| CosmosDB JOIN + DISTINCT クエリのパフォーマンス | 低 | 中 | RU消費をモニタリング。録音数が万単位になった場合はキャッシュ検討 |
| サジェストUI の UX 不備 | 中 | 低 | onBlur タイミング制御で候補消失問題を防止（setTimeout 200ms） |
| 録音数 0 の初回ユーザー | 低 | 低 | サジェストが空でもフリーテキスト入力は機能する |

---

## 11. 結論

- **最大の問題**: タグ入力UIにサジェスト/オートコンプリート機能がなく、既存タグの再利用が実質的に不可能
- **根本原因**: タグ一覧取得 API が存在せず、フロントエンドのタグ入力が単純な `<input>` のみ
- **推奨する修正順序**:
  1. API: ユーザータグ一覧エンドポイント追加
  2. 録音詳細ページ: サジェストドロップダウン UI 追加
  3. 履歴ページ: タグフィルタの `allTags` をAPI取得に切替
- **他 Issue への影響**: なし（独立して修正可能）
- **判定**: **GO** ✅ — データモデル変更不要、フロントエンド + API 追加のみで完結する低リスク修正
