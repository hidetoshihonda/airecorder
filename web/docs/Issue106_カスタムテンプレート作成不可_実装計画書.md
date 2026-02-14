# Issue #106: カスタムテンプレート作成不可 — 実装計画書

## 概要

Issue #106 の根本原因は `api/src/index.ts` でのテンプレート関数 import 欠落。  
修正は最小限で、1行の import 追加 + UIエラーハンドリング改善。

---

## 修正タスク一覧

### Task 1: テンプレート関数の import 追加 🔴 P0

**ファイル**: `api/src/index.ts`

**変更内容**:
```typescript
// Register all functions
import "./functions/recordings";
import "./functions/health";
import "./functions/summary";
import "./functions/blob";
import "./functions/settings";
import "./functions/templates";  // ← 追加
```

**確認**: ビルド成功を確認 (`cd api && npm run build`)

---

### Task 2: テンプレートCRUD操作のエラーハンドリング追加 🟡 P1

**ファイル**: `web/src/app/settings/page.tsx`

#### 2-1: handleCreateTemplate の改善

```typescript
const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.systemPrompt) return;
    const newTemplate = await addCustomTemplate(templateForm);
    if (newTemplate) {
      setCustomTemplates((prev) => [...prev, newTemplate]);
      setTemplateForm({ name: "", description: "", systemPrompt: "" });
      setIsCreating(false);
    } else {
      // TODO: toast通知に置き換え推奨
      alert(t("templateCreateFailed"));
    }
  };
```

#### 2-2: handleUpdateTemplate の改善

```typescript
const handleUpdateTemplate = async () => {
    if (!editingTemplate || !templateForm.name || !templateForm.systemPrompt) return;
    const updated = await updateCustomTemplate(editingTemplate.id, templateForm);
    if (updated) {
      setCustomTemplates((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
      setEditingTemplate(null);
      setTemplateForm({ name: "", description: "", systemPrompt: "" });
    } else {
      alert(t("templateUpdateFailed"));
    }
  };
```

#### 2-3: handleDeleteTemplate の改善

```typescript
const handleDeleteTemplate = async (id: string) => {
    const success = await deleteCustomTemplate(id);
    if (success) {
      setCustomTemplates((prev) => prev.filter((t) => t.id !== id));
    } else {
      alert(t("templateDeleteFailed"));
    }
  };
```

---

### Task 3: i18n エラーメッセージキー追加 🟡 P1

**ファイル**: `web/messages/ja.json`, `web/messages/en.json`, `web/messages/es.json`

SettingsPage セクションに以下を追加:

```json
{
  "SettingsPage": {
    "templateCreateFailed": "テンプレートの作成に失敗しました",
    "templateUpdateFailed": "テンプレートの更新に失敗しました",
    "templateDeleteFailed": "テンプレートの削除に失敗しました"
  }
}
```

英語:
```json
{
  "SettingsPage": {
    "templateCreateFailed": "Failed to create template",
    "templateUpdateFailed": "Failed to update template",
    "templateDeleteFailed": "Failed to delete template"
  }
}
```

スペイン語:
```json
{
  "SettingsPage": {
    "templateCreateFailed": "Error al crear la plantilla",
    "templateUpdateFailed": "Error al actualizar la plantilla",
    "templateDeleteFailed": "Error al eliminar la plantilla"
  }
}
```

---

## 実装手順

| Step | 作業 | ファイル | 見積り |
|------|------|---------|--------|
| 1 | import 追加 | `api/src/index.ts` | 1分 |
| 2 | API ビルド確認 | `cd api && npm run build` | 1分 |
| 3 | エラーハンドリング改善 | `web/src/app/settings/page.tsx` | 10分 |
| 4 | i18n メッセージ追加 | `web/messages/{ja,en,es}.json` | 5分 |
| 5 | Web ビルド確認 | `cd web && npm run build` | 2分 |
| 6 | PR作成・マージ | GitHub | 3分 |
| 7 | デプロイ確認 | Azure Functions + SWA | 5分 |
| 8 | 手動テスト | ブラウザ | 10分 |

**合計**: 約37分

---

## テスト確認事項

- [ ] 設定画面でカスタムテンプレートが作成できる
- [ ] 作成したテンプレートが一覧に即座に表示される
- [ ] テンプレートの編集が正常に動作する
- [ ] テンプレートの削除が正常に動作する
- [ ] 録音詳細画面でカスタムテンプレートが選択肢に表示される
- [ ] API エラー時にエラーメッセージが表示される
- [ ] 未認証時は localStorage フォールバックが引き続き動作する

---

## ブランチ・PR 情報

- **ブランチ名**: `fix/issue-106-template-import`
- **PR タイトル**: `fix: Issue #106 - テンプレートAPIエンドポイントの登録漏れを修正`
- **コミットメッセージ**: `fix: add missing templates function import to api/src/index.ts (Issue #106)`

---

*作成日: 2026-02-11*
*作成者: ReviewAAgent*
