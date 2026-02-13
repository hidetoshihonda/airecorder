# Issue #106: カスタムテンプレートの作成ができない — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: `api/src/index.ts` にテンプレート関数のインポートが欠落しており、Azure Functions ランタイムにテンプレートAPIエンドポイントが一切登録されない。全テンプレートCRUD操作が404エラーとなり、カスタムテンプレート機能が完全に利用不可。
- **影響範囲**: 認証済み全ユーザー（100%）のカスタムテンプレート作成・編集・削除・一覧取得が不可。未認証ユーザーは localStorage フォールバックで動作するため影響なし。
- **修正の緊急度**: 🔴 **Critical（P0）** — 1行の import 追加で即座に修正可能。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係図

```
Settings Page (web/src/app/settings/page.tsx)
  │
  ├── loadCustomTemplates()  ←── meetingTemplates.ts
  ├── addCustomTemplate()    ←── meetingTemplates.ts
  ├── updateCustomTemplate() ←── meetingTemplates.ts
  └── deleteCustomTemplate() ←── meetingTemplates.ts
        │
        ├── [認証済み] templatesApi (web/src/services/templatesApi.ts)
        │     │
        │     └── HTTP → POST/GET/PUT/DELETE /api/templates
        │           │
        │           └── Azure Functions (api/src/functions/templates.ts)  ← 🔴 未登録
        │                 │
        │                 └── templateService.ts → cosmosService.ts → Cosmos DB
        │
        └── [未認証] localStorage フォールバック
```

### 2.2 データフロー（テンプレート作成）

```
ユーザー操作: 設定画面「テンプレート追加」
  ↓
settings/page.tsx: handleCreateTemplate()
  ↓
meetingTemplates.ts: addCustomTemplate({ name, description, systemPrompt })
  ↓ templatesApi.isAuthenticated() → true
templatesApi.create() → POST /api/templates { userId, name, description, systemPrompt }
  ↓
🔴 Azure Functions: テンプレート関数が未登録 → 404 Not Found
  ↓
templatesApi.request(): response.ok = false → { error: "HTTP error 404" }
  ↓
addCustomTemplate(): result.error が存在 → return null
  ↓
handleCreateTemplate(): newTemplate = null → テンプレート追加されず
  ↓
フォームがクリアされ、ユーザーにはフィードバックなし（サイレント失敗）
```

### 2.3 状態管理の構造

| State 変数 | 管理場所 | 用途 |
|---|---|---|
| `customTemplates` | settings/page.tsx (useState) | 表示用テンプレートリスト |
| `isLoadingTemplates` | settings/page.tsx (useState) | ローディング表示制御 |
| `editingTemplate` | settings/page.tsx (useState) | 編集中テンプレート |
| `isCreating` | settings/page.tsx (useState) | 作成フォーム表示制御 |
| `templateForm` | settings/page.tsx (useState) | フォーム入力値 |
| `userId` | templatesApi (class field) | API認証用ユーザーID |

---

## 3. 重大バグ分析 🔴

### BUG-1: テンプレート関数のインポート欠落（Critical）

**場所**: `api/src/index.ts` L1-L7

**コード（現状）**:
```typescript
// Register all functions
import "./functions/recordings";
import "./functions/health";
import "./functions/summary";
import "./functions/blob";
import "./functions/settings";
// ← import "./functions/templates" が存在しない
```

**問題**: `api/src/functions/templates.ts` は存在し、5つのHTTPトリガー（`listTemplates`, `createTemplate`, `templateById`, `bulkImportTemplates`）が定義されているが、エントリポイント `index.ts` でインポートされていない。Azure Functions v4 はインポートされたファイル内の `app.http()` 呼び出しで関数を登録するため、インポートがないと関数が一切登録されない。

**影響**: 認証済みユーザー100%のカスタムテンプレート全CRUD操作が404エラーで失敗する。テンプレート一覧取得も失敗するため、既存テンプレート（もし作成できていたとしても）も表示されない。

**根本原因**: Issue #32（カスタムテンプレートDB移行）のコミット `b69694e` で14ファイルを変更しテンプレートAPI関連ファイルを全て作成したが、`api/src/index.ts` への import 行追加が漏れた。他のサービス（`api/src/services/index.ts`）やモデル（`api/src/models/index.ts`）のバレルファイルには正しくエクスポートが追加されていたが、関数登録のエントリポイントだけが抜けていた。

**修正方針**:
```typescript
// api/src/index.ts
// Register all functions
import "./functions/recordings";
import "./functions/health";
import "./functions/summary";
import "./functions/blob";
import "./functions/settings";
import "./functions/templates";  // ← この1行を追加
```

---

### BUG-2: テンプレート作成失敗時のサイレント失敗（High）

**場所**: `web/src/app/settings/page.tsx` L49-L56

**コード（現状）**:
```typescript
const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.systemPrompt) return;
    const newTemplate = await addCustomTemplate(templateForm);
    if (newTemplate) {
      setCustomTemplates((prev) => [...prev, newTemplate]);
    }
    // ← newTemplate が null の場合もフォームがクリアされ、エラー通知なし
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
    setIsCreating(false);
  };
```

**問題**: `addCustomTemplate()` が `null` を返した場合（API エラー）、フォームがクリアされ作成フォームが閉じるが、ユーザーにエラーメッセージが表示されない。ユーザーは作成が成功したか失敗したか判断できない。

**影響**: 全ユーザーにとって、テンプレート作成失敗時のUXが著しく悪い。「ボタンを押したのに何も起きない」状態になる。

**根本原因**: エラーハンドリングの設計が不足。`addCustomTemplate` は `null` を返すが、呼び出し側でエラー状態を区別していない。

**修正方針**:
```typescript
const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.systemPrompt) return;
    const newTemplate = await addCustomTemplate(templateForm);
    if (newTemplate) {
      setCustomTemplates((prev) => [...prev, newTemplate]);
      setTemplateForm({ name: "", description: "", systemPrompt: "" });
      setIsCreating(false);
    } else {
      // エラーをユーザーに通知（toast等）
      // toast.error(t("templateCreateFailed"));
    }
  };
```

---

### BUG-3: テンプレート一覧取得のサイレント失敗（Medium）

**場所**: `web/src/app/settings/page.tsx` L39-L47

**コード（現状）**:
```typescript
useEffect(() => {
    const load = async () => {
      setIsLoadingTemplates(true);
      try {
        const templates = await loadCustomTemplates();
        setCustomTemplates(templates);
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    load();
  }, []);
```

**問題**: `loadCustomTemplates()` は認証済みの場合 API を呼び出す。API が 404 を返すと、エラー条件 (`result.error`) に入り、localStorage フォールバックに戻る。一見正しく動作するが、DB に保存されたテンプレートが表示されず（新規ユーザーは localStorage も空）、エラーログも出ない。

**影響**: BUG-1 修正後、この問題は解消されるが、API 一時障害時にユーザーはstaleなデータ（localStorageキャッシュ）を見ることになり、データ不整合が起きうる。

**根本原因**: `loadCustomTemplates()` のフォールバック設計は意図的だが、エラー通知がないため、APIがダウンしていることに気づけない。

---

## 4. 設計上の問題 🟡

### 4.1 ✅ Good: localStorage フォールバック設計
`meetingTemplates.ts` の `loadCustomTemplates`, `addCustomTemplate` 等は、未認証時やAPIエラー時に localStorage にフォールバックする設計。オフライン時のレジリエンスとして良い。

### 4.2 ✅ Good: テンプレートサービスの分離
API側: `cosmosService.ts` → `templateService.ts` → `templates.ts`（関数）の3層分離が適切。

### 4.3 ✅ Good: マイグレーション対応
`migrateLocalStorageToDb()` による localStorage → Cosmos DB 移行対応が実装済み。

### 4.4 🟡 Medium: エラーハンドリングの一貫性不足
- `addCustomTemplate()`: 失敗時に `null` を返す（エラーメッセージを伝搬しない）
- `updateCustomTemplate()`: 同上
- `deleteCustomTemplate()`: `boolean` を返す
- エラーの詳細情報が呼び出し元に伝わらない

### 4.5 🟡 Medium: Azure Functions ルート設計の OPTIONS 重複
`listTemplates`（GET/OPTIONS, route: `templates`）と `createTemplate`（POST/OPTIONS, route: `templates`）が同じルートで OPTIONS を重複登録。CORS プリフライトリクエスト時にどちらのハンドラーが呼ばれるか不定。現状は両方同じ CORS ヘッダーを返すため実害はないが、将来的にメンテナンス問題を引き起こす可能性あり。

### 4.6 🟡 Low: テンプレートAPI の認証不備
`authLevel: "anonymous"` で全エンドポイントが定義されているため、Azure Functions を直接呼び出す場合に認証なしでアクセス可能。`userId` はリクエストボディ/クエリから取得しており、なりすましリスクがある。ただし SWA 経由では `staticwebapp.config.json` で `authenticated` ロールが要求されるため、デプロイ環境では保護されている。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #32 (カスタムテンプレートDB移行) ──→ Issue #106 (本Issue)
  └── #32 の実装時に index.ts への import 追加が漏れた（直接的原因）

Issue #106 ──→ Issue #38 (詳細画面テンプレート選択)
  └── #38 はカスタムテンプレートの利用を前提としているため、#106 修正が先行必須
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---|---|---|---|
| `api/src/index.ts` | `templates.ts` | 🔴 import 欠落で全機能停止 | import 追加 |
| `templateService.ts` | `cosmosService.ts` | 🟢 Low（既に正しく実装） | なし |
| `meetingTemplates.ts` | `templatesApi.ts` | 🟢 Low（フォールバック有り） | なし |
| `settings/page.tsx` | `meetingTemplates.ts` | 🟡 エラー通知なし | エラーUX追加 |

### 5.3 他 Issue/機能との相互作用

- **Issue #38（詳細画面テンプレート選択）**: テンプレート一覧取得が動作しないため、カスタムテンプレートが詳細画面で選択できない
- **Issue #42（議事録フォーマット品質改善）**: プリセットテンプレートは影響なし（コード内に直接定義）
- **録音詳細ページ（`recording/page.tsx`）**: `getAllTemplates()` → `loadCustomTemplates()` を呼ぶため、カスタムテンプレートが選択肢に表示されない

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|---|---|---|
| Azure Functions v4 (Node.js 20) | ✅ 対応 | ルート重複のエッジケースあり |
| Azure Static Web Apps | ✅ 対応 | `/api/*` ルート認証は正常 |
| ブラウザ互換性 | N/A | サーバーサイドの問題 |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### Fix 1-1: テンプレート関数の import 追加

**変更ファイル**: `api/src/index.ts`

```typescript
// Register all functions
import "./functions/recordings";
import "./functions/health";
import "./functions/summary";
import "./functions/blob";
import "./functions/settings";
import "./functions/templates";  // ← 追加
```

**影響**: この1行で全テンプレートAPIエンドポイントが有効化される。

### Phase 2: 設計改善（P1）

#### Fix 2-1: テンプレート作成失敗時のエラー通知

**変更ファイル**: `web/src/app/settings/page.tsx`

```typescript
const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.systemPrompt) return;
    const newTemplate = await addCustomTemplate(templateForm);
    if (newTemplate) {
      setCustomTemplates((prev) => [...prev, newTemplate]);
      setTemplateForm({ name: "", description: "", systemPrompt: "" });
      setIsCreating(false);
    } else {
      // エラー表示（簡易的にはalert、理想的にはtoast）
      alert(t("templateCreateFailed") || "テンプレートの作成に失敗しました");
    }
  };
```

同様に `handleUpdateTemplate`、`handleDeleteTemplate` にもエラーハンドリングを追加。

#### Fix 2-2: i18n キーの追加

**変更ファイル**: `web/messages/ja.json`, `web/messages/en.json`, `web/messages/es.json`

各言語にテンプレート操作失敗時のメッセージキーを追加：
- `templateCreateFailed`
- `templateUpdateFailed`
- `templateDeleteFailed`

### Phase 3: 堅牢性強化（P2）

#### Fix 3-1: OPTIONS メソッドの重複解消

`listTemplates` と `createTemplate` の OPTIONS ハンドリングを統合するか、CORS をグローバルミドルウェアで処理する。

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|---|---|
| 認証済み + テンプレート作成 | API 経由で Cosmos DB に保存される |
| 未認証 + テンプレート作成 | localStorage に保存される |
| 認証済み + API 障害時 | localStorage フォールバック |
| 認証済み + テンプレート一覧取得 | Cosmos DB からリスト返却 |
| テンプレート作成後の一覧表示 | 作成したテンプレートが即座に表示される |

### 統合テスト

1. Azure Functions にデプロイ後、`/api/templates` エンドポイントの疎通確認
2. 設定画面でのテンプレートCRUD操作の E2E テスト
3. 録音詳細画面でのカスタムテンプレート選択テスト

### 手動テスト

| テスト項目 | 操作 | 期待結果 |
|---|---|---|
| テンプレート作成 | 設定画面 → 追加 → フォーム入力 → 作成 | テンプレートが一覧に表示 |
| テンプレート編集 | 一覧のペンアイコン → 変更 → 更新 | 変更が反映 |
| テンプレート削除 | 一覧のゴミ箱アイコン | テンプレートが一覧から消える |
| テンプレート使用 | 録音詳細画面 → テンプレート選択 | カスタムテンプレートが選択肢に表示 |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|---|---|---|---|
| 1 | `api/src/index.ts` に import 追加 | 1分 | API全テンプレートエンドポイント有効化 |
| 2 | テンプレートCRUD操作のエラーハンドリング追加 | 15分 | settings/page.tsx |
| 3 | i18n エラーメッセージキー追加 | 5分 | messages/{ja,en,es}.json |
| 4 | ビルド検証・デプロイ | 5分 | Azure Functions + SWA |
| 5 | 手動テスト | 10分 | 設定画面 + 録音詳細画面 |

**合計見積り**: 約 36分

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|---|---|---|---|
| Cosmos DB に templates コンテナ未作成 | 低 | 中 | `createIfNotExists` が使用されているため自動作成される |
| Azure Functions ルート競合 | 低 | 中 | 同一ルート・異メソッドは v4 で正式サポート |
| マイグレーション実行による重複データ | 中 | 低 | `MIGRATION_FLAG_KEY` で二重実行防止済み |
| デプロイ後の既存機能回帰 | 低 | 高 | 他の関数登録に影響なし（追加のみ） |

---

## 11. 結論

### 最大の問題点
Issue #32（カスタムテンプレートDB移行）の実装コミット `b69694e` で `api/src/index.ts` への import 行追加が漏れ、テンプレートAPI エンドポイントが Azure Functions ランタイムに一切登録されていない。これは Issue #103（文字起こし補正失敗）と同様の「配線忘れ」パターンのバグ。

### 推奨する修正順序
1. **[P0]** `api/src/index.ts` に `import "./functions/templates"` を追加
2. **[P1]** テンプレート操作のエラーハンドリング改善
3. **[P1]** i18n エラーメッセージ追加

### 他 Issue への影響サマリー
- Issue #38（詳細画面テンプレート選択）: 本 Issue 修正後に実装可能になる
- Issue #32 に関連する他の機能は全て正常に実装されている

### 判定: `GO` ✅

修正量は極小（1行の import 追加 + UIエラーハンドリング改善）でリスクも低い。即座に修正・デプロイ可能。

---

*分析日: 2026-02-11*
*分析者: ReviewAAgent*
