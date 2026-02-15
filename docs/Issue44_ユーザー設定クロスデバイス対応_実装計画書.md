# Issue #44 ユーザー設定のクロスデバイス対応 - 実装計画書

## 1. 概要

### 目的
ユーザー設定を Cosmos DB に保存し、どのデバイス・ブラウザからでも同じ設定で利用できるようにする。

### 現状の問題
- 設定は localStorage に保存されている
- 別デバイス・別ブラウザでは設定が共有されない
- ログインユーザーでも設定が引き継がれない

### 対象設定項目
| 設定キー | 説明 | デフォルト値 |
|---------|------|-------------|
| `defaultSourceLanguage` | 音声認識言語 | `"ja-JP"` |
| `defaultTargetLanguages` | 翻訳先言語 | `["en-US"]` |
| `theme` | テーマ | `"system"` |
| `autoSaveRecordings` | 自動保存 | `true` |
| `audioQuality` | 音声品質 | `"high"` |
| `noiseSuppression` | ノイズ抑制 | `true` |
| `enableSpeakerDiarization` | 話者識別 | `false` |

## 2. アーキテクチャ

### データフロー

```
[ログインユーザー]
    │
    ▼ ページ読み込み時
AuthContext
    │
    ├── 1. localStorage から設定読み込み（即時表示用）
    │
    └── 2. API から設定取得（非同期）
        │
        ├── 成功: APIの設定で上書き
        │   └── localStorageも更新（キャッシュ）
        │
        └── 失敗: localStorageの値を使用

[設定変更時]
    │
    ├── 1. state更新（即時反映）
    ├── 2. localStorage更新（オフライン対応）
    └── 3. API更新（デバウンス500ms）
        │
        └── 失敗時: 次回ログイン時に同期

[未ログインユーザー]
    │
    └── localStorageのみ使用（従来通り）
```

### Cosmos DB スキーマ

```typescript
// 新規コンテナ: "userSettings"
// パーティションキー: /userId

interface UserSettingsDocument {
  id: string;           // = userId
  userId: string;       // パーティションキー
  settings: {
    defaultSourceLanguage: string;
    defaultTargetLanguages: string[];
    theme: "light" | "dark" | "system";
    autoSaveRecordings: boolean;
    audioQuality: "low" | "medium" | "high";
    noiseSuppression: boolean;
    enableSpeakerDiarization: boolean;
  };
  updatedAt: string;    // ISO 8601
  createdAt: string;    // ISO 8601
}
```

## 3. API設計

### GET /api/settings
ユーザー設定を取得

**リクエスト**
```
GET /api/settings?userId={userId}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "settings": {
      "defaultSourceLanguage": "ja-JP",
      "defaultTargetLanguages": ["en-US"],
      "theme": "system",
      "autoSaveRecordings": true,
      "audioQuality": "high",
      "noiseSuppression": true,
      "enableSpeakerDiarization": true
    },
    "updatedAt": "2026-02-09T10:00:00.000Z"
  }
}
```

**エラー**
- `400`: userId が未指定
- `404`: 設定が存在しない（初回ユーザー）→ デフォルト値を返す

### PUT /api/settings
ユーザー設定を更新（upsert）

**リクエスト**
```json
PUT /api/settings
Content-Type: application/json

{
  "userId": "user123",
  "settings": {
    "enableSpeakerDiarization": true
  }
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "settings": { /* 更新後の全設定 */ },
    "updatedAt": "2026-02-09T10:05:00.000Z"
  }
}
```

## 4. 実装手順

### Step 1: バックエンドAPI実装

#### 1.1 cosmosService.ts に userSettings コンテナ追加

```typescript
// api/src/services/cosmosService.ts

let userSettingsContainer: Container | null = null;

export async function getUserSettingsContainer(): Promise<Container> {
  if (!userSettingsContainer) {
    const db = await getDatabase();
    const { container } = await db.containers.createIfNotExists({
      id: "userSettings",
      partitionKey: { paths: ["/userId"] },
    });
    userSettingsContainer = container;
  }
  return userSettingsContainer;
}
```

#### 1.2 settingsService.ts 新規作成

```typescript
// api/src/services/settingsService.ts

import { getUserSettingsContainer } from "./cosmosService";
import { UserSettings, UserSettingsDocument } from "../models";

const defaultSettings: UserSettings = {
  defaultSourceLanguage: "ja-JP",
  defaultTargetLanguages: ["en-US"],
  theme: "system",
  autoSaveRecordings: true,
  audioQuality: "high",
  noiseSuppression: true,
  enableSpeakerDiarization: false,
};

export async function getUserSettings(userId: string): Promise<UserSettingsDocument> {
  const container = await getUserSettingsContainer();
  
  try {
    const { resource } = await container.item(userId, userId).read<UserSettingsDocument>();
    if (resource) {
      return resource;
    }
  } catch (error: any) {
    if (error.code !== 404) {
      throw error;
    }
  }
  
  // 初回ユーザー: デフォルト設定を返す
  return {
    id: userId,
    userId,
    settings: defaultSettings,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateUserSettings(
  userId: string,
  partialSettings: Partial<UserSettings>
): Promise<UserSettingsDocument> {
  const container = await getUserSettingsContainer();
  const current = await getUserSettings(userId);
  
  const updated: UserSettingsDocument = {
    ...current,
    settings: { ...current.settings, ...partialSettings },
    updatedAt: new Date().toISOString(),
  };
  
  await container.items.upsert(updated);
  return updated;
}
```

#### 1.3 settings.ts（Azure Functions）新規作成

```typescript
// api/src/functions/settings.ts

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getUserSettings, updateUserSettings } from "../services/settingsService";

function jsonResponse<T>(data: T, status: number = 200): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    body: JSON.stringify(data),
  };
}

app.http("getSettings", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "settings",
  handler: async (request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const userId = request.query.get("userId");
    if (!userId) {
      return jsonResponse({ success: false, error: "userId is required" }, 400);
    }

    try {
      const result = await getUserSettings(userId);
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      return jsonResponse({ success: false, error: (error as Error).message }, 500);
    }
  },
});

app.http("updateSettings", {
  methods: ["PUT", "OPTIONS"],
  authLevel: "anonymous",
  route: "settings",
  handler: async (request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = await request.json() as { userId: string; settings: Record<string, unknown> };
      
      if (!body.userId) {
        return jsonResponse({ success: false, error: "userId is required" }, 400);
      }

      const result = await updateUserSettings(body.userId, body.settings);
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      return jsonResponse({ success: false, error: (error as Error).message }, 500);
    }
  },
});
```

### Step 2: フロントエンド実装

#### 2.1 settingsApi.ts 新規作成

```typescript
// web/src/services/settingsApi.ts

import { UserSettings } from "@/types";
import { config } from "@/lib/config";

const API_BASE = config.apiBaseUrl;

export interface UserSettingsResponse {
  settings: UserSettings;
  updatedAt: string;
}

export async function fetchUserSettings(userId: string): Promise<UserSettingsResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/settings?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error("Failed to fetch user settings:", error);
    return null;
  }
}

export async function saveUserSettings(
  userId: string,
  settings: Partial<UserSettings>
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, settings }),
    });
    return response.ok;
  } catch (error) {
    console.error("Failed to save user settings:", error);
    return false;
  }
}
```

#### 2.2 AuthContext.tsx 修正

```typescript
// web/src/contexts/AuthContext.tsx

import { fetchUserSettings, saveUserSettings } from "@/services/settingsApi";

// デバウンス用ユーティリティ
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function AuthProvider({ children }: AuthProviderProps) {
  // ... 既存のstate

  // デバウンスされたAPI保存関数
  const debouncedSaveToApi = useCallback(
    debounce(async (userId: string, settings: UserSettings) => {
      await saveUserSettings(userId, settings);
    }, 500),
    []
  );

  // ログイン時にAPIから設定を取得
  useEffect(() => {
    if (user?.id && settingsLoaded) {
      (async () => {
        const remoteSettings = await fetchUserSettings(user.id);
        if (remoteSettings) {
          setSettings(remoteSettings.settings);
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(remoteSettings.settings));
        }
      })();
    }
  }, [user?.id, settingsLoaded]);

  const updateSettings = useCallback((newSettings: Partial<UserSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      
      // localStorage に保存（オフライン対応）
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save settings to localStorage:", error);
      }
      
      // ログイン中ならAPIにも保存（デバウンス）
      if (user?.id) {
        debouncedSaveToApi(user.id, updated);
      }
      
      return updated;
    });
  }, [user?.id, debouncedSaveToApi]);

  // ...
}
```

## 5. ファイル変更一覧

### 新規ファイル
| ファイル | 説明 |
|---------|------|
| `api/src/services/settingsService.ts` | 設定CRUD操作 |
| `api/src/functions/settings.ts` | Azure Functions エンドポイント |
| `web/src/services/settingsApi.ts` | フロントエンドAPI クライアント |

### 修正ファイル
| ファイル | 変更内容 |
|---------|---------|
| `api/src/services/cosmosService.ts` | userSettingsコンテナ追加 |
| `api/src/index.ts` | settings関数のimport追加 |
| `api/src/models/index.ts` | UserSettingsDocument型追加 |
| `web/src/contexts/AuthContext.tsx` | API連携追加 |
| `web/src/services/index.ts` | settingsApi export追加 |

## 6. テスト戦略

### 手動テストシナリオ

| # | シナリオ | 期待結果 |
|---|---------|---------|
| 1 | ログイン → 設定変更 → 別デバイスでログイン | 同じ設定が反映される |
| 2 | オフラインで設定変更 → オンライン復帰 | 設定が同期される |
| 3 | 未ログインで設定変更 → ログイン | localStorageの設定が維持される |
| 4 | 初回ログイン（設定なし） | デフォルト設定が適用される |

## 7. 見積り

| タスク | 見積り |
|-------|--------|
| バックエンドAPI実装 | 1時間 |
| フロントエンド修正 | 1時間 |
| テスト | 30分 |
| **合計** | **2.5時間** |

## 8. リスク

| リスク | 対策 |
|-------|------|
| API障害時に設定が保存されない | localStorageにもバックアップ保存 |
| 同時編集による競合 | 最新のupdatedAtを優先（Last Write Wins） |
| 初回ログイン時の設定消失 | localStorageの設定をAPIにマイグレーション |
