# Issue #83: 録音のフォルダ/カテゴリ分類 — 実装計画書

> **前提ドキュメント**: [Issue83_フォルダ分類_分析レビュー.md](Issue83_フォルダ分類_分析レビュー.md)
> **ブランチ名**: `feat/issue-83-folder-classification`
> **見積り**: 約 4.5 時間（Phase 1 MVP）

---

## 実装手順（全 15 ステップ）

---

### Step 1: API — Folder モデル定義

**ファイル**: `api/src/models/folder.ts`（新規作成）

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

// Frontend-compatible Folder type (without internal fields)
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

**設計メモ**:
- `FolderDocument` は CosmosDB 内部のドキュメント形式（`userId`, `type` フィールドを含む）
- `Folder` はフロントエンド向けの公開型（内部フィールドを除外）
- `template.ts` の `CustomTemplateDocument` / `CustomTemplate` パターンに準拠

---

### Step 2: API — models/index.ts に export 追加

**ファイル**: `api/src/models/index.ts`

**現在のコード (L1-3)**:
```typescript
export * from "./recording";
export * from "./template";
```

**変更後**:
```typescript
export * from "./recording";
export * from "./template";
export * from "./folder";
```

---

### Step 3: API — cosmosService.ts に getFoldersContainer 追加

**ファイル**: `api/src/services/cosmosService.ts`

**末尾に追記**（L70 の `getTemplatesContainer` 関数の後）:

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

**設計メモ**:
- 既存の `getRecordingsContainer`, `getUserSettingsContainer`, `getTemplatesContainer` と完全同一パターン
- パーティションキー: `/userId`（全コンテナ統一）
- `createIfNotExists` により初回アクセス時に自動作成

---

### Step 4: API — folderService.ts CRUD 実装

**ファイル**: `api/src/services/folderService.ts`（新規作成）

```typescript
import { v4 as uuidv4 } from "uuid";
import { getFoldersContainer } from "./cosmosService";
import { getRecordingsContainer } from "./cosmosService";
import {
  FolderDocument,
  Folder,
  CreateFolderRequest,
  UpdateFolderRequest,
} from "../models";

// Convert Cosmos document to API response format
function toFolder(doc: FolderDocument): Folder {
  return {
    id: doc.id,
    name: doc.name,
    color: doc.color,
    sortOrder: doc.sortOrder,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * List all folders for a user
 */
export async function listFolders(userId: string): Promise<Folder[]> {
  const container = await getFoldersContainer();
  const { resources } = await container.items
    .query<FolderDocument>({
      query:
        "SELECT * FROM c WHERE c.userId = @userId AND c.type = @type ORDER BY c.sortOrder ASC",
      parameters: [
        { name: "@userId", value: userId },
        { name: "@type", value: "folder" },
      ],
    })
    .fetchAll();
  return resources.map(toFolder);
}

/**
 * Create a new folder
 */
export async function createFolder(
  request: CreateFolderRequest
): Promise<Folder> {
  const container = await getFoldersContainer();
  const now = new Date().toISOString();

  // Get current max sortOrder
  const existing = await listFolders(request.userId);
  const maxSortOrder = existing.length > 0
    ? Math.max(...existing.map((f) => f.sortOrder))
    : 0;

  const doc: FolderDocument = {
    id: uuidv4(),
    userId: request.userId,
    name: request.name,
    color: request.color,
    sortOrder: maxSortOrder + 1,
    createdAt: now,
    updatedAt: now,
    type: "folder",
  };

  const { resource } = await container.items.create(doc);
  return toFolder(resource as FolderDocument);
}

/**
 * Get a single folder by ID
 */
export async function getFolder(
  id: string,
  userId: string
): Promise<Folder | null> {
  const container = await getFoldersContainer();
  try {
    const { resource } = await container
      .item(id, userId)
      .read<FolderDocument>();
    return resource ? toFolder(resource) : null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Update an existing folder
 */
export async function updateFolder(
  id: string,
  userId: string,
  updates: UpdateFolderRequest
): Promise<Folder | null> {
  const container = await getFoldersContainer();

  try {
    const { resource: doc } = await container
      .item(id, userId)
      .read<FolderDocument>();

    if (!doc) return null;

    const updated: FolderDocument = {
      ...doc,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const { resource } = await container.item(id, userId).replace(updated);
    return toFolder(resource as FolderDocument);
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a folder and clear folderId from associated recordings
 */
export async function deleteFolder(
  id: string,
  userId: string
): Promise<boolean> {
  const container = await getFoldersContainer();

  try {
    // 1. Clear folderId from all recordings in this folder
    const recordingsContainer = await getRecordingsContainer();
    const { resources: recordings } = await recordingsContainer.items
      .query({
        query: "SELECT c.id FROM c WHERE c.userId = @userId AND c.folderId = @folderId",
        parameters: [
          { name: "@userId", value: userId },
          { name: "@folderId", value: id },
        ],
      })
      .fetchAll();

    for (const rec of recordings) {
      const { resource: fullRec } = await recordingsContainer
        .item(rec.id, userId)
        .read();
      if (fullRec) {
        await recordingsContainer.item(rec.id, userId).replace({
          ...fullRec,
          folderId: undefined,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // 2. Delete the folder
    await container.item(id, userId).delete();
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return false;
    }
    throw error;
  }
}
```

**設計メモ**:
- `templateService.ts` と同一パターン（`toFolder` 変換関数、CRUD 構成）
- `deleteFolder`: 配下の録音の `folderId` を `undefined` に更新してから削除（orphan 防止）
- `createFolder`: `sortOrder` を既存最大値 + 1 で自動設定
- `type: "folder"` フィールドでドキュメント種別を識別（templates パターンと同じ）

---

### Step 5: API — folders.ts REST エンドポイント

**ファイル**: `api/src/functions/folders.ts`（新規作成）

```typescript
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  listFolders,
  createFolder,
  getFolder,
  updateFolder,
  deleteFolder,
} from "../services/folderService";
import {
  ApiResponse,
  Folder,
  CreateFolderRequest,
  UpdateFolderRequest,
} from "../models";

// Helper function to create JSON response
function jsonResponse<T>(
  data: ApiResponse<T>,
  status: number = 200
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    body: JSON.stringify(data),
  };
}

// GET /api/folders - List all folders for a user
app.http("listFolders", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "folders",
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

      const folders = await listFolders(userId);
      return jsonResponse<Folder[]>({ success: true, data: folders });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// POST /api/folders - Create a new folder
app.http("createFolder", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "folders",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as CreateFolderRequest;

      if (!body.userId || !body.name) {
        return jsonResponse(
          { success: false, error: "userId and name are required" },
          400
        );
      }

      const folder = await createFolder(body);
      return jsonResponse<Folder>({ success: true, data: folder }, 201);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// GET/PUT/DELETE /api/folders/{id}
app.http("folderById", {
  methods: ["GET", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "folders/{id}",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;

    try {
      // GET - Get folder by ID
      if (request.method === "GET") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const folder = await getFolder(id!, userId);
        if (!folder) {
          return jsonResponse(
            { success: false, error: "Folder not found" },
            404
          );
        }

        return jsonResponse<Folder>({ success: true, data: folder });
      }

      // PUT - Update folder
      if (request.method === "PUT") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const body = (await request.json()) as UpdateFolderRequest;
        const updated = await updateFolder(id!, userId, body);

        if (!updated) {
          return jsonResponse(
            { success: false, error: "Folder not found" },
            404
          );
        }

        return jsonResponse<Folder>({ success: true, data: updated });
      }

      // DELETE - Delete folder
      if (request.method === "DELETE") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const deleted = await deleteFolder(id!, userId);
        if (!deleted) {
          return jsonResponse(
            { success: false, error: "Folder not found" },
            404
          );
        }

        return jsonResponse({ success: true });
      }

      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

**設計メモ**:
- `templates.ts` と完全同一のパターン（`jsonResponse` ヘルパー、CRUD ハンドラ構成）
- `listFolders` / `createFolder`: `/api/folders` ルート（GET/POST）
- `folderById`: `/api/folders/{id}` ルート（GET/PUT/DELETE）

---

### Step 6: API — recordings.ts に folderId パラメータ追加

**ファイル**: `api/src/functions/recordings.ts`

**変更箇所**: L57-67（`listRecordings` ハンドラ内）

**現在のコード**:
```typescript
      const page = parseInt(request.query.get("page") || "1", 10);
      const limit = parseInt(request.query.get("limit") || "20", 10);
      const search = request.query.get("search") || undefined;

      const result = await listRecordings(userId, page, limit, search);
```

**変更後**:
```typescript
      const page = parseInt(request.query.get("page") || "1", 10);
      const limit = parseInt(request.query.get("limit") || "20", 10);
      const search = request.query.get("search") || undefined;
      const folderId = request.query.get("folderId") || undefined;

      const result = await listRecordings(userId, page, limit, search, folderId);
```

---

### Step 7: API — recordingService.ts に folderId フィルタ追加

**ファイル**: `api/src/services/recordingService.ts`

**変更箇所**: L118-135（`listRecordings` 関数）

**現在のコード**:
```typescript
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string
): Promise<PaginatedResponse<Recording>> {
  const container = await getRecordingsContainer();

  let queryText = "SELECT * FROM c WHERE c.userId = @userId";
  const parameters: Array<{ name: string; value: string | number }> = [
    { name: "@userId", value: userId },
  ];

  if (search) {
    queryText += " AND CONTAINS(LOWER(c.title), LOWER(@search))";
    parameters.push({ name: "@search", value: search });
  }

  queryText += " ORDER BY c.createdAt DESC";
```

**変更後**:
```typescript
export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string
): Promise<PaginatedResponse<Recording>> {
  const container = await getRecordingsContainer();

  let queryText = "SELECT * FROM c WHERE c.userId = @userId";
  const parameters: Array<{ name: string; value: string | number }> = [
    { name: "@userId", value: userId },
  ];

  if (search) {
    queryText += " AND CONTAINS(LOWER(c.title), LOWER(@search))";
    parameters.push({ name: "@search", value: search });
  }

  if (folderId) {
    queryText += " AND c.folderId = @folderId";
    parameters.push({ name: "@folderId", value: folderId });
  }

  queryText += " ORDER BY c.createdAt DESC";
```

---

### Step 8: API — ビルド確認

```bash
cd api && npm run build
```

`tsc` による型チェックで全ファイルの整合性を確認。

---

### Step 9: Web — types/index.ts に Folder 型追加

**ファイル**: `web/src/types/index.ts`

**追加位置**: `Recording` インターフェースの直後（L22 付近）

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

---

### Step 10: Web — foldersApi.ts クライアント作成

**ファイル**: `web/src/services/foldersApi.ts`（新規作成）

```typescript
import { Folder, ApiResponse } from "@/types";

// API base URL - use environment variable or default to Azure Functions URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface CreateFolderInput {
  name: string;
  color?: string;
}

export interface UpdateFolderInput {
  name?: string;
  color?: string;
  sortOrder?: number;
}

class FoldersApiService {
  private baseUrl: string;
  private userId: string | null = null;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  setUserId(userId: string | null) {
    this.userId = userId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  isAuthenticated(): boolean {
    return this.userId !== null && this.userId.length > 0;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: "Invalid JSON response from server" };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return { data: data?.data as T };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }

  /**
   * List all folders for the current user
   */
  async list(): Promise<ApiResponse<Folder[]>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<Folder[]>(
      `/folders?userId=${encodeURIComponent(this.userId!)}`
    );
  }

  /**
   * Create a new folder
   */
  async create(input: CreateFolderInput): Promise<ApiResponse<Folder>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<Folder>("/folders", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId,
        ...input,
      }),
    });
  }

  /**
   * Update an existing folder
   */
  async update(
    id: string,
    updates: UpdateFolderInput
  ): Promise<ApiResponse<Folder>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<Folder>(
      `/folders/${id}?userId=${encodeURIComponent(this.userId!)}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    );
  }

  /**
   * Delete a folder (recordings in this folder will become uncategorized)
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<void>(
      `/folders/${id}?userId=${encodeURIComponent(this.userId!)}`,
      { method: "DELETE" }
    );
  }
}

export const foldersApi = new FoldersApiService();
```

**設計メモ**:
- `templatesApi.ts` と完全同一パターン
- `setUserId` は `AuthContext` 側で `recordingsApi.setUserId()` と同時に呼ばれるよう連携が必要
  - `AuthContext` で `foldersApi.setUserId(userId)` を追加する

---

### Step 11: Web — services/index.ts に export 追加

**ファイル**: `web/src/services/index.ts`

**追加**:
```typescript
export { foldersApi } from "./foldersApi";
export type { CreateFolderInput, UpdateFolderInput } from "./foldersApi";
```

---

### Step 12: Web — recordingsApi.ts に folderId 追加

**ファイル**: `web/src/services/recordingsApi.ts`

**変更 1**: `UpdateRecordingInput` に `folderId` 追加（L27-34）

```typescript
export interface UpdateRecordingInput {
  title?: string;
  transcript?: Transcript;
  translations?: Record<string, Translation>;
  summary?: Summary;
  tags?: string[];
  status?: Recording["status"];
  folderId?: string | null;  // null = フォルダから外す
}
```

**変更 2**: `listRecordings` メソッドに `folderId` パラメータ追加（L120-140）

**現在**:
```typescript
  async listRecordings(
    page: number = 1,
    limit: number = 20,
    search?: string
  ): Promise<ApiResponse<PaginatedResponse<Recording>>> {
    // ...
    const params = new URLSearchParams({
      userId: this.userId!,
      page: page.toString(),
      limit: limit.toString(),
    });

    if (search) {
      params.append("search", search);
    }
```

**変更後**:
```typescript
  async listRecordings(
    page: number = 1,
    limit: number = 20,
    search?: string,
    folderId?: string
  ): Promise<ApiResponse<PaginatedResponse<Recording>>> {
    // ...
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
```

---

### Step 13: Web — history/page.tsx にフォルダ UI 追加

**ファイル**: `web/src/app/history/page.tsx`

#### 13.1 import 追加

```typescript
import { FolderOpen, Plus, MoreVertical } from "lucide-react";
import { Folder } from "@/types";
import { foldersApi } from "@/services";
```

#### 13.2 state 追加（L49-55 付近）

```typescript
const [folders, setFolders] = useState<Folder[]>([]);
const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
const [movingRecordingId, setMovingRecordingId] = useState<string | null>(null);
```

#### 13.3 フォルダ読み込み useEffect 追加

```typescript
// フォルダ一覧を取得
useEffect(() => {
  if (!isAuthenticated) return;
  const fetchFolders = async () => {
    const response = await foldersApi.list();
    if (response.data) {
      setFolders(response.data);
    }
  };
  fetchFolders();
}, [isAuthenticated]);
```

#### 13.4 録音一覧取得に folderId を追加

`useEffect` 内と `fetchRecordings` 関数内の `recordingsApi.listRecordings()` 呼び出しに `selectedFolderId` を追加:

```typescript
const response = await recordingsApi.listRecordings(
  1,
  50,
  searchQuery || undefined,
  selectedFolderId || undefined
);
```

`useEffect` の依存配列に `selectedFolderId` を追加。
`fetchRecordings` の `useCallback` 依存配列にも `selectedFolderId` を追加。

#### 13.5 フォルダ操作ハンドラ追加

```typescript
// フォルダ作成
const handleCreateFolder = async () => {
  const name = prompt(t("folderNamePrompt"));
  if (!name?.trim()) return;

  const response = await foldersApi.create({ name: name.trim() });
  if (response.data) {
    setFolders((prev) => [...prev, response.data!]);
  }
};

// フォルダ削除
const handleDeleteFolder = async (folderId: string) => {
  if (!confirm(t("deleteFolderConfirm"))) return;

  const response = await foldersApi.delete(folderId);
  if (!response.error) {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
    }
    fetchRecordings();
  }
};

// フォルダ名変更
const handleRenameFolder = async (folder: Folder) => {
  const newName = prompt(t("folderNamePrompt"), folder.name);
  if (!newName?.trim() || newName.trim() === folder.name) return;

  const response = await foldersApi.update(folder.id, { name: newName.trim() });
  if (response.data) {
    setFolders((prev) =>
      prev.map((f) => (f.id === folder.id ? response.data! : f))
    );
  }
};

// 録音をフォルダに移動
const handleMoveToFolder = async (recordingId: string, folderId: string | null) => {
  setMovingRecordingId(recordingId);
  const response = await recordingsApi.updateRecording(recordingId, {
    folderId: folderId,
  });
  if (!response.error) {
    // 選択中フォルダからの移動なら一覧を更新
    if (selectedFolderId) {
      setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
    } else {
      // 「すべて」表示の場合はローカル更新
      setRecordings((prev) =>
        prev.map((r) =>
          r.id === recordingId ? { ...r, folderId: folderId || undefined } : r
        )
      );
    }
  }
  setMovingRecordingId(null);
};
```

#### 13.6 フォルダタブバー UI（検索バーの上に配置）

```tsx
{/* Folder Tabs */}
<div className="mb-4 flex items-center gap-2 overflow-x-auto pb-2">
  <button
    onClick={() => setSelectedFolderId(null)}
    className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
      selectedFolderId === null
        ? "bg-blue-600 text-white"
        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
    }`}
  >
    <FolderOpen className="h-3.5 w-3.5" />
    {t("allFolders")}
  </button>
  {folders.map((folder) => (
    <div key={folder.id} className="group relative flex shrink-0">
      <button
        onClick={() => setSelectedFolderId(folder.id)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          selectedFolderId === folder.id
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        {folder.name}
      </button>
      {/* フォルダ操作（右クリック/長押しメニュー代替） */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          const action = prompt(
            `${folder.name}:\n1: ${t("renameFolder")}\n2: ${t("deleteFolder")}`
          );
          if (action === "1") handleRenameFolder(folder);
          if (action === "2") handleDeleteFolder(folder.id);
        }}
        className="ml-0.5 hidden rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 group-hover:inline-flex"
      >
        <MoreVertical className="h-3 w-3" />
      </button>
    </div>
  ))}
  <button
    onClick={handleCreateFolder}
    className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600"
  >
    <Plus className="h-3.5 w-3.5" />
    {t("newFolder")}
  </button>
</div>
```

#### 13.7 各録音カードにフォルダ移動ボタン追加

操作ボタン群（Play / Download / Delete の横）にフォルダ移動ドロップダウンを追加:

```tsx
{/* Folder move dropdown */}
<div className="relative">
  <select
    value=""
    onChange={(e) => {
      const value = e.target.value;
      if (value === "__remove__") {
        handleMoveToFolder(recording.id, null);
      } else if (value) {
        handleMoveToFolder(recording.id, value);
      }
    }}
    disabled={movingRecordingId === recording.id}
    className="h-8 w-8 cursor-pointer appearance-none rounded bg-transparent p-0 text-transparent hover:bg-gray-100"
    title={t("moveToFolder")}
  >
    <option value="">{t("moveToFolder")}</option>
    {recording.folderId && (
      <option value="__remove__">{t("removeFromFolder")}</option>
    )}
    {folders
      .filter((f) => f.id !== recording.folderId)
      .map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
  </select>
  <FolderOpen className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-gray-600" />
</div>
```

> **Note**: Phase 1 では `<select>` ベースのシンプルな UI。Phase 2 でカスタムドロップダウンに変更可能。

---

### Step 14: Web — i18n メッセージ追加

**ファイル**: `web/messages/ja.json`（HistoryPage セクション末尾に追加）

```json
    "allFolders": "すべて",
    "newFolder": "新規フォルダ",
    "folderNamePrompt": "フォルダ名を入力してください",
    "moveToFolder": "フォルダに移動",
    "removeFromFolder": "フォルダから外す",
    "renameFolder": "名前変更",
    "deleteFolder": "フォルダを削除",
    "deleteFolderConfirm": "このフォルダを削除しますか？配下の録音は未分類に移動されます。"
```

**ファイル**: `web/messages/en.json`（HistoryPage セクション末尾に追加）

```json
    "allFolders": "All",
    "newFolder": "New Folder",
    "folderNamePrompt": "Enter folder name",
    "moveToFolder": "Move to folder",
    "removeFromFolder": "Remove from folder",
    "renameFolder": "Rename",
    "deleteFolder": "Delete folder",
    "deleteFolderConfirm": "Delete this folder? Recordings inside will become uncategorized."
```

**ファイル**: `web/messages/es.json`（HistoryPage セクション末尾に追加）

```json
    "allFolders": "Todos",
    "newFolder": "Nueva carpeta",
    "folderNamePrompt": "Ingrese el nombre de la carpeta",
    "moveToFolder": "Mover a carpeta",
    "removeFromFolder": "Quitar de carpeta",
    "renameFolder": "Renombrar",
    "deleteFolder": "Eliminar carpeta",
    "deleteFolderConfirm": "¿Eliminar esta carpeta? Las grabaciones se moverán a sin categoría."
```

---

### Step 15: Web — ビルド + Lint 確認

```bash
cd web && npm run build
cd web && npm run lint
```

---

## AuthContext への foldersApi 連携

**確認が必要なファイル**: `web/src/contexts/AuthContext.tsx`

既存の `AuthContext` で `recordingsApi.setUserId(userId)` が呼ばれている箇所に `foldersApi.setUserId(userId)` も追加する必要がある。

```typescript
import { foldersApi } from "@/services";
// ...
// 既存の setUserId 呼び出し箇所に追加
foldersApi.setUserId(userId);
```

---

## ファイル変更サマリー

| 操作 | ファイル | Step |
|------|---------|------|
| **新規** | `api/src/models/folder.ts` | 1 |
| 修正 | `api/src/models/index.ts` | 2 |
| 修正 | `api/src/services/cosmosService.ts` | 3 |
| **新規** | `api/src/services/folderService.ts` | 4 |
| **新規** | `api/src/functions/folders.ts` | 5 |
| 修正 | `api/src/functions/recordings.ts` | 6 |
| 修正 | `api/src/services/recordingService.ts` | 7 |
| 修正 | `web/src/types/index.ts` | 9 |
| **新規** | `web/src/services/foldersApi.ts` | 10 |
| 修正 | `web/src/services/index.ts` | 11 |
| 修正 | `web/src/services/recordingsApi.ts` | 12 |
| 修正 | `web/src/app/history/page.tsx` | 13 |
| 修正 | `web/messages/ja.json` | 14 |
| 修正 | `web/messages/en.json` | 14 |
| 修正 | `web/messages/es.json` | 14 |
| 修正 | `web/src/contexts/AuthContext.tsx` | 補足 |

**合計**: 新規 4 ファイル + 既存 12 ファイル修正

---

## Git ワークフロー

```bash
# 1. main を最新に
git checkout main
git pull origin main

# 2. ブランチ作成
git checkout -b feat/issue-83-folder-classification

# 3. API 側実装 (Step 1-7)
# ... ファイル作成・修正 ...

# 4. API ビルド確認
cd api && npm run build

# 5. Web 側実装 (Step 9-14)
# ... ファイル作成・修正 ...

# 6. Web ビルド + lint 確認
cd web && npm run build
cd web && npm run lint

# 7. コミット
git add -A
git commit -m "feat: add folder/category classification for recordings (Issue #83)"

# 8. プッシュ + PR
git push origin feat/issue-83-folder-classification
gh pr create --title "feat: Add folder/category classification #83" \
  --body "Closes #83\n\n## Changes\n- Add Folder CRUD API (CosmosDB + REST endpoints)\n- Add folderId filter to recordings/list\n- Add folder tab UI in history page\n- Add folder move dropdown for each recording\n- i18n support (ja/en/es)"

# 9. CI 確認 + マージ
gh pr checks <PR番号> --watch
gh pr merge <PR番号> --squash
```
