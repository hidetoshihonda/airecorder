# Issue #32: カスタムテンプレート Cosmos DB 移行 - 詳細実装計画書

## 1. エグゼクティブサマリー

カスタム議事録テンプレートを localStorage から Cosmos DB に移行し、クロスデバイス対応を実現する。既存の `recordings` API のパターンを踏襲し、一貫性のある実装を行う。

**影響範囲**: 設定画面、録音画面（テンプレート選択）、API（新規エンドポイント）  
**見積り**: 約 4.5 時間  
**リスク**: 低（既存パターンの踏襲、破壊的変更なし）

---

## 2. アーキテクチャ設計

### 2.1 現状アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (web/)                          │
├─────────────────────────────────────────────────────────────────┤
│  settings/page.tsx  ──┬──→  meetingTemplates.ts  ──→ localStorage │
│                       │                                          │
│  page.tsx (録音)     ←┴──   getAllTemplates()                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 移行後アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (web/)                          │
├─────────────────────────────────────────────────────────────────┤
│  settings/page.tsx  ──┬──→  templatesApi.ts  ──→ /api/templates │
│                       │          ↓                               │
│  page.tsx (録音)     ←┴──  meetingTemplates.ts (非同期化)        │
│                              │                                   │
│                    [未認証時] localStorage (フォールバック)      │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (api/)                           │
├─────────────────────────────────────────────────────────────────┤
│  functions/templates.ts  ──→  templateService.ts  ──→ Cosmos DB │
│                                      ↓                          │
│                            cosmosService.ts                     │
│                          (getTemplatesContainer)                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 データフロー

```
[認証済みユーザー]
GET /api/templates?userId=xxx  →  Cosmos DB (templates コンテナ)
POST /api/templates            →  新規作成
PUT /api/templates/{id}        →  更新
DELETE /api/templates/{id}     →  削除

[未認証ユーザー]
localStorage (従来通り) ← フォールバック
```

---

## 3. Cosmos DB 設計

### 3.1 コンテナ設定

| 項目 | 値 |
|------|-----|
| コンテナ名 | `templates` |
| パーティションキー | `/userId` |
| インデックス | デフォルト（自動） |

### 3.2 ドキュメントスキーマ

```typescript
// api/src/models/template.ts
export interface CustomTemplateDocument {
  id: string;              // UUID v4
  userId: string;          // パーティションキー
  name: string;            // テンプレート名
  description: string;     // 説明
  systemPrompt: string;    // AI プロンプト
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  type: "custom-template"; // ドキュメント種別識別子
}

export interface CreateTemplateRequest {
  userId: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
}
```

---

## 4. 実装詳細

### Phase 1: バックエンド API 実装

#### Step 1-1: Cosmos DB コンテナ追加 (15min)

**ファイル**: [api/src/services/cosmosService.ts](../../../api/src/services/cosmosService.ts)

```typescript
// 追加するコード
let templatesContainer: Container | null = null;

export async function getTemplatesContainer(): Promise<Container> {
  if (!templatesContainer) {
    const db = await getDatabase();
    const { container } = await db.containers.createIfNotExists({
      id: "templates",
      partitionKey: { paths: ["/userId"] },
    });
    templatesContainer = container;
  }
  return templatesContainer;
}
```

#### Step 1-2: 型定義追加 (10min)

**ファイル**: `api/src/models/template.ts` (新規作成)

```typescript
// api/src/models/template.ts
export interface CustomTemplateDocument {
  id: string;
  userId: string;
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
  type: "custom-template";
}

export interface CreateTemplateRequest {
  userId: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
}

// フロントエンドと互換の CustomTemplate 型
export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}
```

**ファイル**: `api/src/models/index.ts` に追加

```typescript
export * from "./template";
```

#### Step 1-3: テンプレートサービス実装 (30min)

**ファイル**: `api/src/services/templateService.ts` (新規作成)

```typescript
// api/src/services/templateService.ts
import { v4 as uuidv4 } from "uuid";
import { getTemplatesContainer } from "./cosmosService";
import {
  CustomTemplateDocument,
  CustomTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
} from "../models";

// Document → API レスポンス変換
function toCustomTemplate(doc: CustomTemplateDocument): CustomTemplate {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    systemPrompt: doc.systemPrompt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listTemplates(userId: string): Promise<CustomTemplate[]> {
  const container = await getTemplatesContainer();
  const { resources } = await container.items
    .query<CustomTemplateDocument>({
      query: "SELECT * FROM c WHERE c.userId = @userId AND c.type = @type",
      parameters: [
        { name: "@userId", value: userId },
        { name: "@type", value: "custom-template" },
      ],
    })
    .fetchAll();
  return resources.map(toCustomTemplate);
}

export async function createTemplate(
  request: CreateTemplateRequest
): Promise<CustomTemplate> {
  const container = await getTemplatesContainer();
  const now = new Date().toISOString();

  const doc: CustomTemplateDocument = {
    id: uuidv4(),
    userId: request.userId,
    name: request.name,
    description: request.description,
    systemPrompt: request.systemPrompt,
    createdAt: now,
    updatedAt: now,
    type: "custom-template",
  };

  const { resource } = await container.items.create(doc);
  return toCustomTemplate(resource as CustomTemplateDocument);
}

export async function getTemplate(
  id: string,
  userId: string
): Promise<CustomTemplate | null> {
  const container = await getTemplatesContainer();
  try {
    const { resource } = await container
      .item(id, userId)
      .read<CustomTemplateDocument>();
    return resource ? toCustomTemplate(resource) : null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateTemplate(
  id: string,
  userId: string,
  updates: UpdateTemplateRequest
): Promise<CustomTemplate | null> {
  const container = await getTemplatesContainer();
  const existing = await getTemplate(id, userId);
  if (!existing) return null;

  // 既存ドキュメントを取得して更新
  const { resource: doc } = await container
    .item(id, userId)
    .read<CustomTemplateDocument>();

  const updated: CustomTemplateDocument = {
    ...doc!,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const { resource } = await container.item(id, userId).replace(updated);
  return toCustomTemplate(resource as CustomTemplateDocument);
}

export async function deleteTemplate(
  id: string,
  userId: string
): Promise<boolean> {
  const container = await getTemplatesContainer();
  try {
    await container.item(id, userId).delete();
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return false;
    }
    throw error;
  }
}

// バルクインポート（マイグレーション用）
export async function bulkImportTemplates(
  userId: string,
  templates: Omit<CustomTemplate, "id" | "createdAt" | "updatedAt">[]
): Promise<CustomTemplate[]> {
  const results: CustomTemplate[] = [];
  for (const tmpl of templates) {
    const created = await createTemplate({
      userId,
      name: tmpl.name,
      description: tmpl.description,
      systemPrompt: tmpl.systemPrompt,
    });
    results.push(created);
  }
  return results;
}
```

**ファイル**: `api/src/services/index.ts` に追加

```typescript
export * from "./templateService";
```

#### Step 1-4: HTTP ハンドラ実装 (45min)

**ファイル**: `api/src/functions/templates.ts` (新規作成)

```typescript
// api/src/functions/templates.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  bulkImportTemplates,
} from "../services/templateService";
import { ApiResponse, CustomTemplate, CreateTemplateRequest } from "../models";

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

// GET /api/templates - テンプレート一覧
app.http("listTemplates", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates",
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

      const templates = await listTemplates(userId);
      return jsonResponse<CustomTemplate[]>({ success: true, data: templates });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// POST /api/templates - テンプレート作成
app.http("createTemplate", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as CreateTemplateRequest;

      if (!body.userId || !body.name || !body.systemPrompt) {
        return jsonResponse(
          { success: false, error: "userId, name, and systemPrompt are required" },
          400
        );
      }

      const template = await createTemplate(body);
      return jsonResponse<CustomTemplate>({ success: true, data: template }, 201);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// GET/PUT/DELETE /api/templates/{id}
app.http("templateById", {
  methods: ["GET", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates/{id}",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;

    try {
      // GET
      if (request.method === "GET") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const template = await getTemplate(id!, userId);
        if (!template) {
          return jsonResponse(
            { success: false, error: "Template not found" },
            404
          );
        }

        return jsonResponse<CustomTemplate>({ success: true, data: template });
      }

      // PUT
      if (request.method === "PUT") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const body = await request.json();
        const updated = await updateTemplate(id!, userId, body as Record<string, unknown>);

        if (!updated) {
          return jsonResponse(
            { success: false, error: "Template not found" },
            404
          );
        }

        return jsonResponse<CustomTemplate>({ success: true, data: updated });
      }

      // DELETE
      if (request.method === "DELETE") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const deleted = await deleteTemplate(id!, userId);
        if (!deleted) {
          return jsonResponse(
            { success: false, error: "Template not found" },
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

// POST /api/templates/bulk - バルクインポート（マイグレーション用）
app.http("bulkImportTemplates", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates/bulk",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as {
        userId: string;
        templates: Array<{ name: string; description: string; systemPrompt: string }>;
      };

      if (!body.userId || !Array.isArray(body.templates)) {
        return jsonResponse(
          { success: false, error: "userId and templates array are required" },
          400
        );
      }

      const imported = await bulkImportTemplates(body.userId, body.templates);
      return jsonResponse<CustomTemplate[]>({ success: true, data: imported }, 201);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

---

### Phase 2: フロントエンド実装

#### Step 2-1: API クライアント作成 (20min)

**ファイル**: `web/src/services/templatesApi.ts` (新規作成)

```typescript
// web/src/services/templatesApi.ts
import { CustomTemplate, ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

class TemplatesApiService {
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
   * カスタムテンプレート一覧取得
   */
  async list(): Promise<ApiResponse<CustomTemplate[]>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate[]>(
      `/templates?userId=${encodeURIComponent(this.userId!)}`
    );
  }

  /**
   * カスタムテンプレート作成
   */
  async create(
    template: Omit<CustomTemplate, "id" | "createdAt" | "updatedAt">
  ): Promise<ApiResponse<CustomTemplate>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate>("/templates", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId,
        ...template,
      }),
    });
  }

  /**
   * カスタムテンプレート更新
   */
  async update(
    id: string,
    updates: Partial<Pick<CustomTemplate, "name" | "description" | "systemPrompt">>
  ): Promise<ApiResponse<CustomTemplate>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate>(
      `/templates/${id}?userId=${encodeURIComponent(this.userId!)}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    );
  }

  /**
   * カスタムテンプレート削除
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<void>(
      `/templates/${id}?userId=${encodeURIComponent(this.userId!)}`,
      { method: "DELETE" }
    );
  }

  /**
   * バルクインポート（マイグレーション用）
   */
  async bulkImport(
    templates: Array<{ name: string; description: string; systemPrompt: string }>
  ): Promise<ApiResponse<CustomTemplate[]>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate[]>("/templates/bulk", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId,
        templates,
      }),
    });
  }
}

export const templatesApi = new TemplatesApiService();
```

**ファイル**: `web/src/services/index.ts` に追加

```typescript
export { templatesApi } from "./templatesApi";
```

#### Step 2-2: meetingTemplates.ts 非同期化 (30min)

**ファイル**: [web/src/lib/meetingTemplates.ts](../../../web/src/lib/meetingTemplates.ts)

```typescript
// 変更: 同期関数 → 非同期関数
// localStorage をフォールバックとして維持

import { MeetingTemplate, CustomTemplate } from "@/types";
import { templatesApi } from "@/services/templatesApi";

// ... PRESET_TEMPLATES は変更なし ...

const CUSTOM_TEMPLATES_KEY = "airecorder-custom-templates";
const MIGRATION_FLAG_KEY = "airecorder-templates-migrated";

// ─── localStorage ヘルパー（フォールバック用） ───

function loadFromLocalStorage(): CustomTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(templates: CustomTemplate[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
}

function clearLocalStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CUSTOM_TEMPLATES_KEY);
}

function isMigrated(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(MIGRATION_FLAG_KEY) === "true";
}

function setMigrated(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MIGRATION_FLAG_KEY, "true");
}

// ─── マイグレーション ───

export async function migrateLocalStorageToDb(): Promise<boolean> {
  if (!templatesApi.isAuthenticated()) return false;
  if (isMigrated()) return true;

  const localTemplates = loadFromLocalStorage();
  if (localTemplates.length === 0) {
    setMigrated();
    return true;
  }

  const result = await templatesApi.bulkImport(
    localTemplates.map((t) => ({
      name: t.name,
      description: t.description,
      systemPrompt: t.systemPrompt,
    }))
  );

  if (!result.error) {
    clearLocalStorage();
    setMigrated();
    return true;
  }
  return false;
}

// ─── 非同期 CRUD 関数 ───

export async function loadCustomTemplates(): Promise<CustomTemplate[]> {
  // 認証済みなら API から取得
  if (templatesApi.isAuthenticated()) {
    await migrateLocalStorageToDb(); // 初回マイグレーション
    const result = await templatesApi.list();
    if (!result.error && result.data) {
      return result.data;
    }
  }
  // 未認証 or API エラー時は localStorage
  return loadFromLocalStorage();
}

export async function addCustomTemplate(
  template: Omit<CustomTemplate, "id" | "createdAt" | "updatedAt">
): Promise<CustomTemplate | null> {
  if (templatesApi.isAuthenticated()) {
    const result = await templatesApi.create(template);
    if (!result.error && result.data) {
      return result.data;
    }
    return null;
  }

  // 未認証: localStorage
  const templates = loadFromLocalStorage();
  const newTemplate: CustomTemplate = {
    ...template,
    id: `custom-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  templates.push(newTemplate);
  saveToLocalStorage(templates);
  return newTemplate;
}

export async function updateCustomTemplate(
  id: string,
  updates: Partial<Pick<CustomTemplate, "name" | "description" | "systemPrompt">>
): Promise<CustomTemplate | null> {
  if (templatesApi.isAuthenticated()) {
    const result = await templatesApi.update(id, updates);
    if (!result.error && result.data) {
      return result.data;
    }
    return null;
  }

  // 未認証: localStorage
  const templates = loadFromLocalStorage();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return null;
  templates[index] = {
    ...templates[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveToLocalStorage(templates);
  return templates[index];
}

export async function deleteCustomTemplate(id: string): Promise<boolean> {
  if (templatesApi.isAuthenticated()) {
    const result = await templatesApi.delete(id);
    return !result.error;
  }

  // 未認証: localStorage
  const templates = loadFromLocalStorage();
  const filtered = templates.filter((t) => t.id !== id);
  if (filtered.length === templates.length) return false;
  saveToLocalStorage(filtered);
  return true;
}

// ─── 非同期 getAllTemplates ───

export async function getAllTemplates(): Promise<MeetingTemplate[]> {
  const customs = await loadCustomTemplates();
  return [...PRESET_TEMPLATES, ...customs.map(customToMeetingTemplate)];
}

// customToMeetingTemplate, getTemplateById は変更なし
```

#### Step 2-3: settings/page.tsx 非同期対応 (30min)

**ファイル**: [web/src/app/settings/page.tsx](../../../web/src/app/settings/page.tsx#L28)

```diff
- const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(() => loadCustomTemplates());
+ const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
+ const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

+ // テンプレート読み込み
+ useEffect(() => {
+   const load = async () => {
+     setIsLoadingTemplates(true);
+     const templates = await loadCustomTemplates();
+     setCustomTemplates(templates);
+     setIsLoadingTemplates(false);
+   };
+   load();
+ }, []);

- const handleCreateTemplate = () => {
+ const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.systemPrompt) return;
-   addCustomTemplate(templateForm);
-   setCustomTemplates(loadCustomTemplates());
+   const newTemplate = await addCustomTemplate(templateForm);
+   if (newTemplate) {
+     setCustomTemplates((prev) => [...prev, newTemplate]);
+   }
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
    setIsCreating(false);
  };

- const handleUpdateTemplate = () => {
+ const handleUpdateTemplate = async () => {
    if (!editingTemplate || !templateForm.name || !templateForm.systemPrompt) return;
-   updateCustomTemplate(editingTemplate.id, templateForm);
-   setCustomTemplates(loadCustomTemplates());
+   const updated = await updateCustomTemplate(editingTemplate.id, templateForm);
+   if (updated) {
+     setCustomTemplates((prev) =>
+       prev.map((t) => (t.id === updated.id ? updated : t))
+     );
+   }
    setEditingTemplate(null);
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
  };

- const handleDeleteTemplate = (id: string) => {
+ const handleDeleteTemplate = async (id: string) => {
-   deleteCustomTemplate(id);
-   setCustomTemplates(loadCustomTemplates());
+   const success = await deleteCustomTemplate(id);
+   if (success) {
+     setCustomTemplates((prev) => prev.filter((t) => t.id !== id));
+   }
  };
```

#### Step 2-4: page.tsx 非同期対応 (20min)

**ファイル**: `web/src/app/page.tsx` (該当箇所)

- `getAllTemplates()` が非同期になるため、呼び出し元を `useEffect` + state で管理
- 具体的な変更は既存コードの構造を確認後に決定

---

### Phase 3: マイグレーション & テスト

#### Step 3-1: 初回ログイン時マイグレーション (実装済み)

`migrateLocalStorageToDb()` が `loadCustomTemplates()` 内で自動実行される。

#### Step 3-2: templatesApi への userId 設定

**ファイル**: `web/src/contexts/AuthContext.tsx` (既存の userId 設定箇所に追加)

```typescript
import { templatesApi } from "@/services/templatesApi";

// ログイン成功時
templatesApi.setUserId(user.userId);

// ログアウト時
templatesApi.setUserId(null);
```

---

## 5. API エンドポイント仕様

| メソッド | ルート | 説明 | リクエスト | レスポンス |
|---------|--------|------|-----------|-----------|
| GET | `/api/templates?userId=xxx` | 一覧取得 | - | `{ success, data: CustomTemplate[] }` |
| POST | `/api/templates` | 新規作成 | `{ userId, name, description, systemPrompt }` | `{ success, data: CustomTemplate }` |
| GET | `/api/templates/{id}?userId=xxx` | 単体取得 | - | `{ success, data: CustomTemplate }` |
| PUT | `/api/templates/{id}?userId=xxx` | 更新 | `{ name?, description?, systemPrompt? }` | `{ success, data: CustomTemplate }` |
| DELETE | `/api/templates/{id}?userId=xxx` | 削除 | - | `{ success: true }` |
| POST | `/api/templates/bulk` | バルクインポート | `{ userId, templates: [...] }` | `{ success, data: CustomTemplate[] }` |

---

## 6. テストシナリオ

### 6.1 正常系

| # | シナリオ | 期待結果 |
|---|---------|---------|
| 1 | 認証済みユーザーがテンプレート作成 | Cosmos DB に保存される |
| 2 | 認証済みユーザーがテンプレート一覧取得 | Cosmos DB から取得される |
| 3 | 別デバイスで同一ユーザーがログイン | 同じテンプレートが表示される |
| 4 | 未認証ユーザーがテンプレート作成 | localStorage に保存される |
| 5 | localStorage にテンプレートがある状態でログイン | Cosmos DB にマイグレーションされる |

### 6.2 異常系

| # | シナリオ | 期待結果 |
|---|---------|---------|
| 1 | API エラー時 | localStorage フォールバック |
| 2 | ネットワーク切断時 | localStorage フォールバック |
| 3 | userId 未指定で API 呼び出し | 400 エラー |

---

## 7. 実装ロードマップ

| Step | 作業内容 | 見積り | 依存 |
|------|---------|--------|------|
| 1-1 | cosmosService.ts に getTemplatesContainer 追加 | 15min | - |
| 1-2 | models/template.ts 型定義 | 10min | - |
| 1-3 | templateService.ts CRUD実装 | 30min | 1-1, 1-2 |
| 1-4 | functions/templates.ts HTTPハンドラ | 45min | 1-3 |
| 2-1 | templatesApi.ts API クライアント | 20min | 1-4 |
| 2-2 | meetingTemplates.ts 非同期化 | 30min | 2-1 |
| 2-3 | settings/page.tsx 非同期対応 | 30min | 2-2 |
| 2-4 | page.tsx 非同期対応 | 20min | 2-2 |
| 3-1 | AuthContext.tsx に templatesApi.setUserId 追加 | 10min | 2-1 |
| 3-2 | E2E テスト・動作確認 | 30min | All |

**合計**: 約 4.5 時間

---

## 8. リスク評価

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| 非同期化による呼び出し元バグ | 中 | 中 | TypeScript コンパイルエラーで検出 |
| マイグレーション失敗 | 低 | 高 | localStorage を削除せず保持、リトライ可能 |
| API レイテンシ | 低 | 低 | ローディング表示、楽観的更新 |
| Cosmos DB コスト増 | 低 | 低 | テンプレート数は少ない、RU 消費軽微 |

---

## 9. 結論

- **GO** 判定: 既存パターン踏襲、破壊的変更なし、リスク低
- 推奨: Phase 1 → Phase 2 → Phase 3 の順序で実装
- 注意点: 非同期化に伴う呼び出し元の変更を漏れなく実施
