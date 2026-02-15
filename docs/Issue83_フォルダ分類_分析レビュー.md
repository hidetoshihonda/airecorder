# Issue #83: 録音のフォルダ/カテゴリ分類 — 深掘り分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 録音データがフラットなリスト表示のみで、大量の録音を整理・分類する手段がない。Recording モデルに `folderId` は型定義済みだが、API ロジック・DB コンテナ・フロントエンド UI のいずれも未実装。
- **影響範囲**: 全ユーザーの録音管理 UX に影響。録音数が 10+ になると検索のみでは限界。
- **修正の緊急度**: **P2（Enhancement）** — 既存機能のバグではないが、UX 向上に直結する中優先度機能。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係図

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                         │
│                                                               │
│  history/page.tsx ──→ recordingsApi.ts ──→ GET /recordings/list│
│       │                                                       │
│       └──→ foldersApi.ts (NEW) ──→ GET/POST/PUT/DELETE /folders│
│                                                               │
│  types/index.ts  ←── Folder interface (NEW)                   │
│  services/index.ts ←── foldersApi export (NEW)                │
└──────────────────────────┬────────────────────────────────────┘
                           │ HTTP (fetch)
┌──────────────────────────▼────────────────────────────────────┐
│                   Backend (Azure Functions)                     │
│                                                                 │
│  functions/folders.ts (NEW) ──→ folderService.ts (NEW)         │
│                                     │                           │
│  functions/recordings.ts ──→ recordingService.ts               │
│       (folderId filter 追加)     (folderId WHERE句 追加)       │
│                                     │                           │
│                            cosmosService.ts                     │
│                         getFoldersContainer() (NEW)             │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                     CosmosDB                                    │
│                                                                 │
│  recordings (PK: /userId) ── 既存: folderId フィールド定義済み  │
│  folders (PK: /userId)   ── NEW: フォルダドキュメント           │
│  userSettings (PK: /userId)                                     │
│  templates (PK: /userId)                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 データフロー図

```
[ユーザー] ── フォルダ作成 ──→ [foldersApi.create()] ──→ POST /api/folders
  ──→ [folderService.createFolder()] ──→ CosmosDB folders

[ユーザー] ── フォルダ選択 ──→ [recordingsApi.listRecordings(folderId)]
  ──→ GET /api/recordings/list?folderId=xxx
  ──→ [recordingService.listRecordings(folderId)]
  ──→ CosmosDB recordings (WHERE c.folderId = @folderId)

[ユーザー] ── 録音をフォルダ移動 ──→ [recordingsApi.updateRecording(id, { folderId })]
  ──→ PUT /api/recordings/{id}
  ──→ [recordingService.updateRecording()] ──→ CosmosDB recordings

[ユーザー] ── フォルダ削除 ──→ [foldersApi.delete(id)]
  ──→ DELETE /api/folders/{id}
  ──→ [folderService.deleteFolder()] ──→ CosmosDB folders + 配下録音の folderId を null に
```

### 2.3 状態管理の構造

**現在の `history/page.tsx` の state（L49-55）:**

| State | 型 | 用途 |
|-------|----|------|
| `recordings` | `Recording[]` | 録音一覧 |
| `isLoading` | `boolean` | ローディング中 |
| `error` | `string \| null` | エラーメッセージ |
| `searchQuery` | `string` | 検索文字列 |
| `isDeleting` | `string \| null` | 削除中の録音 ID |
| `loadingAudioId` | `string \| null` | 音声読み込み中の録音 ID |

**追加が必要な state:**

| State | 型 | 用途 |
|-------|----|------|
| `folders` | `Folder[]` | フォルダ一覧 |
| `selectedFolderId` | `string \| null` | 選択中フォルダ ID（null = すべて） |
| `isFolderLoading` | `boolean` | フォルダ読み込み中 |
| `showFolderDialog` | `boolean` | フォルダ作成/編集ダイアログ |
| `editingFolder` | `Folder \| null` | 編集中のフォルダ |
| `movingRecordingId` | `string \| null` | フォルダ移動中の録音 ID |

---

## 3. 重大バグ分析 🔴

### BUG-1: listRecordings API で folderId クエリパラメータが無視される [High]

**場所**: `api/src/functions/recordings.ts` L57-67
**コード**:
```typescript
const page = parseInt(request.query.get("page") || "1", 10);
const limit = parseInt(request.query.get("limit") || "20", 10);
const search = request.query.get("search") || undefined;
// ❌ folderId の読み取りがない

const result = await listRecordings(userId, page, limit, search);
// ❌ folderId が渡されていない
```
**問題**: `ListRecordingsQuery` に `folderId` が定義されているにもかかわらず、API ハンドラが `folderId` クエリパラメータを読み取っていない。
**影響**: フォルダによるフィルタリングが不可能。全ユーザーに影響。
**根本原因**: 型定義だけ先行して作成され、ロジック実装が後回しにされた。
**修正方針**:
```typescript
const folderId = request.query.get("folderId") || undefined;
const result = await listRecordings(userId, page, limit, search, folderId);
```

---

### BUG-2: recordingService.listRecordings に folderId フィルタが欠落 [High]

**場所**: `api/src/services/recordingService.ts` L118-135
**コード**:
```typescript
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string  // ❌ folderId パラメータがない
): Promise<PaginatedResponse<Recording>> {
  let queryText = "SELECT * FROM c WHERE c.userId = @userId";
  // ❌ folderId の WHERE 句がない
```
**問題**: SQL クエリに `c.folderId = @folderId` 条件がない。
**影響**: DB レベルでフォルダフィルタリング不可。
**根本原因**: BUG-1 と同じ。
**修正方針**:
```typescript
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string
): Promise<PaginatedResponse<Recording>> {
  // ...
  if (folderId) {
    queryText += " AND c.folderId = @folderId";
    parameters.push({ name: "@folderId", value: folderId });
  }
```

---

### BUG-3: Web 側 UpdateRecordingInput に folderId がない [High]

**場所**: `web/src/services/recordingsApi.ts` L27-34
**コード**:
```typescript
export interface UpdateRecordingInput {
  title?: string;
  transcript?: Transcript;
  translations?: Record<string, Translation>;
  summary?: Summary;
  tags?: string[];
  status?: Recording["status"];
  // ❌ folderId がない（API 側の UpdateRecordingRequest には存在）
}
```
**問題**: API 側の `UpdateRecordingRequest`（`api/src/models/recording.ts` L60-68）には `folderId?: string` があるが、Web 側の `UpdateRecordingInput` に欠落。
**影響**: フロントエンドから録音のフォルダ移動が不可能。
**根本原因**: API モデルとフロントエンド型の非対称性。
**修正方針**: `folderId?: string | null` を追加（null は「フォルダから外す」操作）。

---

## 4. 設計上の問題 🟡

### 4.1 Folder エンティティの不在 [Medium]
- `Folder` インターフェースが API 側にも Web 側にも存在しない
- CosmosDB に `folders` コンテナがない
- フォルダ CRUD サービスが存在しない
- ✅ Good: `Recording.folderId` は先行して定義されており、DB スキーマ変更は不要

### 4.2 API クライアントの request() メソッド重複 [Low]
- `recordingsApi.ts` と `templatesApi.ts` が同じ `request<T>()` ヘルパーをそれぞれ持つ
- 新規 `foldersApi.ts` でも同パターンを踏襲する必要がある
- リファクタリング候補だが、今回のスコープ外（安定性優先）

### 4.3 フロントエンドの state 管理がシンプル [Low — 現状で OK]
- `history/page.tsx` は `useState` のみで管理
- フォルダ機能で state が 6 つ増えるが、FSM までは不要
- ✅ Good: 現在の `useEffect` + `useCallback` パターンは適切

### 4.4 i18n メッセージにフォルダ関連キーがない [Medium]
- `ja.json` / `en.json` / `es.json` の `HistoryPage` セクション（L148-175）にフォルダ関連メッセージなし
- 新規キーの追加が必要

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #83 (フォルダ分類) ──→ 依存なし（独立した新機能）
Issue #83 ←── Issue #84 (タグ/検索) [将来: フォルダ×タグの複合フィルタ]
```

- **ブロッカー**: なし。完全に独立して実装可能。
- **並行作業**: 他の全 Issue と並行可能。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `folders` CosmosDB コンテナ | CosmosDB サービス | Low | `createIfNotExists`（既存3コンテナで実績あり） |
| `folderService.ts` | `cosmosService.ts` | None | 既存パターンのコピー |
| `foldersApi.ts` | `templatesApi.ts` パターン | None | 完全にコピー可能 |
| `history/page.tsx` フォルダ UI | `foldersApi` + `recordingsApi` | Low | API 実装後にUI追加 |
| i18n メッセージ | 3 言語ファイル | None | キー追加のみ |

### 5.3 他 Issue/機能との相互作用

| Issue | 相互作用 | リスク |
|-------|---------|--------|
| #84 タグ/検索 | フォルダ + タグの複合フィルタ UI が将来必要 | Low |
| #79-82 (P2 Enhancement) | UI 変更の競合なし | None |
| #120 (AI補正コピー) | PR #129 で解決済み、影響なし | None |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome 90+ | ✅ 完全対応 | None |
| Safari 14+ | ✅ 完全対応（標準 DOM API のみ使用） | None |
| Firefox 90+ | ✅ 完全対応 | None |
| iOS Safari | ✅ レスポンシブ対応済み | Low: フォルダタブの横スクロール要確認 |
| Node.js 18+ (Azure Functions) | ✅ 現行バージョン | None |

※ フォルダ機能は標準 REST API + DOM のみで、ブラウザ API 互換性リスクなし。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正 + フォルダ基盤（P0）

#### 7.1 API: Folder モデル定義
**ファイル**: `api/src/models/folder.ts`（新規）

```typescript
// Folder data model for Cosmos DB
export interface FolderDocument {
  id: string;
  userId: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  type: "folder";
}

export interface Folder {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFolderRequest {
  userId: string;
  name: string;
  color?: string;
}

export interface UpdateFolderRequest {
  name?: string;
  color?: string;
  sortOrder?: number;
}
```

#### 7.2 API: models/index.ts に export 追加
**ファイル**: `api/src/models/index.ts`
**変更**: `export * from "./folder"` 追加

#### 7.3 API: CosmosDB コンテナ追加
**ファイル**: `api/src/services/cosmosService.ts`
**変更**: `getFoldersContainer()` 関数追加（末尾に追記、既存パターン準拠）

```typescript
let foldersContainer: Container | null = null;

export async function getFoldersContainer(): Promise<Container> {
  if (!foldersContainer) {
    const db = await getDatabase();
    const { container } = await db.containers.createIfNotExists({
      id: "folders",
      partitionKey: { paths: ["/userId"] },
    });
    foldersContainer = container;
  }
  return foldersContainer;
}
```

#### 7.4 API: Folder CRUD サービス
**ファイル**: `api/src/services/folderService.ts`（新規）
- `listFolders(userId)` — SQL: `WHERE c.userId = @userId AND c.type = @type ORDER BY c.sortOrder ASC`
- `createFolder(request)` — `uuidv4()` で ID 生成、`sortOrder` は既存最大値 + 1
- `getFolder(id, userId)` — 単件取得
- `updateFolder(id, userId, updates)` — 部分更新
- `deleteFolder(id, userId)` — フォルダ削除 + **配下録音の folderId を null に一括更新**

#### 7.5 API: Folder REST エンドポイント
**ファイル**: `api/src/functions/folders.ts`（新規）
- `GET /api/folders?userId=xxx` → `listFolders`（templates.ts の listTemplates パターン）
- `POST /api/folders` → `createFolder`
- `GET/PUT/DELETE /api/folders/{id}?userId=xxx` → `getFolder` / `updateFolder` / `deleteFolder`

#### 7.6 API: BUG-1 & BUG-2 修正 — recordings に folderId フィルタ追加
**ファイル**: `api/src/functions/recordings.ts` L57-67
- `request.query.get("folderId")` の読み取り追加
- `listRecordings()` への受け渡し追加

**ファイル**: `api/src/services/recordingService.ts` L118-135
- `folderId?: string` パラメータ追加
- SQL に `AND c.folderId = @folderId` 条件分岐追加

### Phase 2: フロントエンド実装（P1）

#### 7.7 Web: Folder 型定義
**ファイル**: `web/src/types/index.ts`
**追加**: `Folder` インターフェース（Recording の直後に配置）

```typescript
export interface Folder {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

#### 7.8 Web: foldersApi クライアント
**ファイル**: `web/src/services/foldersApi.ts`（新規）
- `templatesApi.ts` と同一パターンで実装
- `list()`, `create(input)`, `update(id, updates)`, `delete(id)` メソッド

#### 7.9 Web: services/index.ts に export 追加
**ファイル**: `web/src/services/index.ts`
**追加**: `export { foldersApi } from "./foldersApi"`

#### 7.10 Web: BUG-3 修正 — recordingsApi に folderId 追加
**ファイル**: `web/src/services/recordingsApi.ts`
- `UpdateRecordingInput` に `folderId?: string | null` 追加
- `listRecordings()` に `folderId?: string` パラメータ追加

#### 7.11 Web: history/page.tsx にフォルダ UI 追加
**ファイル**: `web/src/app/history/page.tsx`

**UI レイアウト:**
```
[録音履歴]                                    [更新]
┌──────────────────────────────────────────────────┐
│  [📁すべて] [📁定例会議] [📁1on1] [+ 新規フォルダ]  │ ← フォルダタブ（横スクロール）
├──────────────────────────────────────────────────┤
│  [🔍 録音を検索...]                                │
├──────────────────────────────────────────────────┤
│  📄 録音タイトル                    ▶ ⬇ 🗑 [📁→]  │ ← フォルダ移動ボタン
│  📄 録音タイトル                    ▶ ⬇ 🗑 [📁→]  │
└──────────────────────────────────────────────────┘
```

**追加する UI コンポーネント:**
1. **フォルダタブバー**: 検索バーの上、横スクロール対応の pill/chip UI
2. **フォルダ移動ボタン**: 各録音カードの操作ボタン群にドロップダウン追加
3. **フォルダ管理ダイアログ**: 作成・名前変更用の `prompt()` ベースのシンプル UI（Phase 1）

#### 7.12 Web: i18n メッセージ追加
**ファイル**: `web/messages/ja.json`, `en.json`, `es.json`

**追加キー（HistoryPage セクション）:**

| キー | ja | en | es |
|------|----|----|-----|
| `allFolders` | すべて | All | Todos |
| `newFolder` | 新規フォルダ | New Folder | Nueva carpeta |
| `folderNamePrompt` | フォルダ名を入力 | Enter folder name | Ingrese nombre de carpeta |
| `moveToFolder` | フォルダに移動 | Move to folder | Mover a carpeta |
| `removeFromFolder` | フォルダから外す | Remove from folder | Quitar de carpeta |
| `renameFolder` | フォルダ名を変更 | Rename folder | Renombrar carpeta |
| `deleteFolder` | フォルダを削除 | Delete folder | Eliminar carpeta |
| `deleteFolderConfirm` | このフォルダを削除しますか？ | Delete this folder? | ¿Eliminar esta carpeta? |
| `folderDeleted` | フォルダを削除しました | Folder deleted | Carpeta eliminada |
| `folderCreated` | フォルダを作成しました | Folder created | Carpeta creada |
| `movedToFolder` | フォルダに移動しました | Moved to folder | Movido a carpeta |

### Phase 3: 堅牢性強化（P2 — 将来対応）

- フォルダのドラッグ&ドロップ並び替え
- フォルダのネスト（サブフォルダ）
- フォルダごとの録音数バッジ
- 録音詳細ページでのフォルダ表示
- フォルダの色カスタマイズ UI（カラーピッカー）

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|-------------|------|---------|
| フォルダ作成 | `{ userId, name: "会議" }` | Folder ドキュメント作成、sortOrder 自動設定 |
| フォルダ名変更 | `{ name: "定例会議" }` | `updatedAt` 更新、他フィールド不変 |
| フォルダ削除 | `deleteFolder(id, userId)` | フォルダ削除 + 配下録音の `folderId` → null |
| 録音のフォルダ移動 | `updateRecording(id, { folderId })` | `folderId` 更新 |
| フォルダフィルタ | `listRecordings(userId, 1, 20, undefined, folderId)` | 該当フォルダの録音のみ返却 |
| 「すべて」フィルタ | `listRecordings(userId, 1, 20)` | 全録音返却 |
| 検索 + フォルダ | `listRecordings(userId, 1, 20, "会議", folderId)` | フォルダ内で検索結果のみ |
| 空フォルダ削除 | `deleteFolder(emptyFolderId, userId)` | フォルダのみ削除、録音影響なし |

### 8.2 統合テスト

| シナリオ | テスト内容 |
|---------|-----------|
| フォルダ CRUD フロー | 作成 → 一覧 → 更新 → 削除 |
| orphan 処理 | 録音 A,B → フォルダ X → X 削除 → A,B の folderId = null |
| フィルタ + ページネーション | 50件中20件がフォルダX → Xフィルタ → 20件、ページネーション正常 |
| フォルダ移動 | 録音をフォルダ A → B → 未分類と移動 |

### 8.3 手動テスト

| テスト項目 | Chrome | Safari | iOS Safari | Firefox |
|-----------|--------|--------|------------|---------|
| フォルダタブの横スクロール | - | - | - | - |
| フォルダ移動ドロップダウン表示 | - | - | - | - |
| フォルダ作成ダイアログ | - | - | - | - |
| 検索 + フォルダフィルタ併用 | - | - | - | - |
| レスポンシブ表示（スマホ） | - | - | - | - |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API: `folder.ts` モデル定義 | 15min | 新規ファイル |
| 2 | API: `models/index.ts` export 追加 | 2min | 1行追加 |
| 3 | API: `cosmosService.ts` に `getFoldersContainer` 追加 | 10min | 既存ファイル末尾 |
| 4 | API: `folderService.ts` CRUD 実装 | 45min | 新規ファイル |
| 5 | API: `folders.ts` REST エンドポイント | 30min | 新規ファイル |
| 6 | API: `recordings.ts` に folderId パラメータ追加 | 10min | L57-67 修正 |
| 7 | API: `recordingService.ts` に folderId フィルタ追加 | 15min | L118-145 修正 |
| 8 | API: `npm run build` 型チェック | 5min | - |
| 9 | Web: `types/index.ts` に Folder 型追加 | 5min | 型定義追加 |
| 10 | Web: `foldersApi.ts` クライアント作成 | 30min | 新規ファイル |
| 11 | Web: `services/index.ts` に export 追加 | 2min | 2行追加 |
| 12 | Web: `recordingsApi.ts` に folderId 追加 | 10min | 2箇所修正 |
| 13 | Web: `history/page.tsx` フォルダ UI | 60min | 大幅修正 |
| 14 | Web: i18n メッセージ追加（3言語） | 15min | 3ファイル |
| 15 | Web: `npm run build` + lint | 10min | - |
| | **合計** | **約 4.5h** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| CosmosDB `folders` コンテナ自動作成失敗 | Low | Medium | `createIfNotExists`（既存3コンテナで実績あり） |
| フォルダ削除時の録音 orphan | Medium | Medium | `deleteFolder` 内で配下録音の folderId → null |
| フォルダタブ横スクロール不自然 | Low | Low | `overflow-x-auto` + `scrollbar-hide` |
| 既存録音の folderId が undefined | None | None | 「すべて」がデフォルト、undefined = 未分類 |
| フォルダ名重複 | Low | Low | UI で警告、API ではユニーク制約なし |
| state 増加による re-render | Low | Low | フォルダ操作は低頻度 |

---

## 11. コード品質チェックリスト

### コード品質・バグ
- [x] 非同期処理のレースコンディション → フォルダ CRUD は独立操作、問題なし
- [x] リソースリーク → REST API のみ、WebSocket/Stream なし
- [x] null/undefined チェック → `folderId` は optional、undefined 時はフィルタなし
- [x] エラーハンドリング → 既存の try-catch パターンに準拠
- [x] 型安全性 → 全インターフェース定義済み、`any` 使用なし

### 状態管理
- [x] 状態マシンの有無 → useState で十分（離散的操作）
- [x] 無効な状態の組み合わせ → `selectedFolderId` + `searchQuery` は独立して有効
- [x] Rapid click 安全性 → ダイアログベースで自然に防止

### アーキテクチャ
- [x] 単一責任原則 → `folderService` は Folder CRUD のみ ✅ Good
- [x] 重複コード → API クライアントの `request()` は重複するが既存パターン準拠
- [x] 未使用コード → `ListRecordingsQuery.folderId` が活用される ✅

### API・外部サービス
- [x] API キー露出 → なし（CosmosDB 接続は server-side のみ）
- [x] ネットワーク切断時 → 既存の error state 表示パターンで対応

### パフォーマンス
- [x] 不要な re-render → `useEffect` 依存配列で制御
- [x] バンドルサイズ → `history/page.tsx` 内で完結

### UX
- [x] デッドロック → フォルダ操作中も他操作可能
- [x] エラーメッセージ → i18n 対応
- [x] ローディングフィードバック → Spinner 表示

### セキュリティ
- [x] 認証 → 既存の `userId` ベース認証パターン準拠
- [x] 認可 → CosmosDB PK `/userId` で他ユーザーのフォルダにアクセス不可 ✅ Good

---

## 12. 結論

- **最大の問題点**: `folderId` が型定義のみで API ロジック・DB・UI の 3 層すべてで未実装
- **推奨する修正順序**: API モデル → CosmosDB → API サービス → API エンドポイント → Web 型 → Web API → Web UI → i18n
- **他 Issue への影響**: なし（完全に独立した新機能）
- **✅ Good な設計判断**:
  - `Recording.folderId` が事前に定義されており、DB マイグレーション不要
  - CosmosDB の `createIfNotExists` パターンにより新コンテナの自動作成が安全
  - `templates` API/サービスが完全なリファレンス実装として使用可能
- **判定**: **GO** ✅ — 依存関係なし、既存パターンのコピーで安全に実装可能
