# カスタムテンプレート DB 移行 実装計画書

## 概要

現在、カスタム議事録テンプレートは **localStorage** に保存されているため、同一ユーザーが別デバイス・別ブラウザからアクセスした場合にテンプレートが共有されない。  
本改修では、カスタムテンプレートの永続化先を **Cosmos DB** に移行し、クロスデバイスでの利用を可能にする。

## 現状分析

### 現在のアーキテクチャ

```
[Settings Page] ──→ meetingTemplates.ts ──→ localStorage
     ↕                                          ↕
[Recording Page] ←── getAllTemplates() ←── loadCustomTemplates()
```

### 関連ファイル

| ファイル | 役割 |
|---------|------|
| `web/src/types/index.ts` | `CustomTemplate` インターフェース定義 |
| `web/src/lib/meetingTemplates.ts` | CRUD ヘルパー（localStorage） |
| `web/src/app/settings/page.tsx` | テンプレート管理 UI |
| `web/src/app/page.tsx` | 議事録生成時のテンプレート選択 |
| `api/src/services/cosmosService.ts` | Cosmos DB 接続管理 |
| `api/src/services/recordingService.ts` | 録音 CRUD（参考パターン） |

### 現在の `CustomTemplate` 型

```typescript
interface CustomTemplate {
  id: string;          // "custom-{timestamp}"
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}
```

## 設計方針

### 1. Cosmos DB コンテナ

- **コンテナ名**: `templates`
- **パーティションキー**: `/userId`（既存 `recordings` コンテナと同じ設計）
- **ドキュメント構造**:

```typescript
interface CustomTemplateDocument {
  id: string;              // UUID v4
  userId: string;          // パーティションキー
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  type: "custom-template"; // 将来的にコンテナ共有時の識別子
}
```

### 2. API エンドポイント

| メソッド | ルート | 説明 |
|---------|--------|------|
| `GET` | `/api/templates` | ユーザーのカスタムテンプレート一覧取得 |
| `POST` | `/api/templates` | 新規テンプレート作成 |
| `PUT` | `/api/templates/{id}` | テンプレート更新 |
| `DELETE` | `/api/templates/{id}` | テンプレート削除 |

全エンドポイントで Azure SWA 認証（`/.auth/me`）を前提とし、`userId` をヘッダーまたは EasyAuth クレームから取得する。

### 3. フロントエンド変更

#### `meetingTemplates.ts` の変更

localStorage ベースの CRUD 関数を API 呼び出しに置き換える：

```typescript
// Before: localStorage
export function loadCustomTemplates(): CustomTemplate[] {
  const stored = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
  return stored ? JSON.parse(stored) : [];
}

// After: API
export async function loadCustomTemplates(): Promise<CustomTemplate[]> {
  const res = await fetch("/api/templates");
  if (!res.ok) return [];
  const { data } = await res.json();
  return data;
}
```

**注意**: 同期関数 → 非同期関数に変わるため、呼び出し側の変更が必要。

#### 呼び出し元の変更

- `settings/page.tsx`: `useEffect` でテンプレート読み込み → state で管理
- `page.tsx`: `getAllTemplates()` を非同期化 → `useEffect` + state
- `getAllTemplates()`: 非同期化

### 4. 認証フロー

```
[Frontend] ──fetch("/api/templates")──→ [Azure SWA Proxy]
                                              │
                                    (EasyAuth: x-ms-client-principal)
                                              │
                                              ↓
                                     [Azure Functions]
                                              │
                                    (userId from principal)
                                              │
                                              ↓
                                        [Cosmos DB]
                                     (partition: userId)
```

現在 `recordings` API も同じパターンで `userId` をクエリパラメータから受け取っている（EasyAuth 統合は未完了）。  
テンプレート API でも同様に当面は `userId` クエリパラメータで対応し、将来的に EasyAuth 統合に移行する。

### 5. マイグレーション戦略

既存ユーザーが localStorage に保存済みのカスタムテンプレートを失わないよう、ワンタイムのマイグレーション処理を実装する：

```
1. アプリ起動時に localStorage にカスタムテンプレートが存在するかチェック
2. 存在する場合、API 経由で Cosmos DB にバルク保存
3. 成功後、localStorage から削除
4. マイグレーション完了フラグを localStorage にセット
```

## 実装ステップ

### Phase 1: バックエンド API（api/）

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 1-1 | `cosmosService.ts` に `getTemplatesContainer()` 追加 | 15min |
| 1-2 | `api/src/services/templateService.ts` 新規作成（CRUD） | 30min |
| 1-3 | `api/src/functions/templates.ts` 新規作成（HTTP ハンドラ） | 45min |
| 1-4 | `api/src/models/template.ts` 型定義追加 | 10min |

### Phase 2: フロントエンド移行（web/）

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 2-1 | `web/src/services/templatesApi.ts` 新規作成（API クライアント） | 20min |
| 2-2 | `meetingTemplates.ts` を非同期 API 呼び出しに変更 | 30min |
| 2-3 | `settings/page.tsx` の CRUD を非同期対応 | 30min |
| 2-4 | `page.tsx` のテンプレート読み込みを非同期対応 | 20min |

### Phase 3: マイグレーション & テスト

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 3-1 | localStorage → DB ワンタイムマイグレーション実装 | 30min |
| 3-2 | 未認証時のフォールバック（localStorage 継続利用） | 20min |
| 3-3 | E2E テスト・動作確認 | 30min |

**合計見積り**: 約 4.5 時間

## リスクと対策

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| 未認証ユーザーのテンプレートが消失 | 中 | 高 | 未認証時は localStorage にフォールバック |
| API レイテンシによるUI遅延 | 低 | 中 | 楽観的更新（Optimistic UI）＋ローディング表示 |
| 同期→非同期への変更による呼び出し元のバグ | 中 | 中 | TypeScript コンパイルエラーで検出可能 |
| Cosmos DB コンテナ追加のコスト | 低 | 低 | RU 消費は軽微（テンプレート数は少ない） |

## 未認証時の挙動

現状、アプリは未認証でも利用可能。テンプレート DB 移行後も以下の方針で互換性を維持：

- **認証済み**: Cosmos DB から読み書き
- **未認証**: localStorage で従来通り動作（クロスデバイス共有不可）
- **初回ログイン時**: localStorage → DB マイグレーション実行

## スコープ外

- プリセットテンプレートのカスタマイズ機能
- テンプレートの共有・エクスポート機能
- テンプレートのバージョン管理
