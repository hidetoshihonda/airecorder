# コントリビューションガイド

AI Voice Recorder プロジェクトへの貢献方法について説明します。

## ⚠️ 重要：ブランチ運用ルール

### デフォルトブランチ

- **`main`** が唯一の本番ブランチです
- `main` への直接プッシュは **禁止** されています（ブランチ保護ルール適用済み）
- `master` ブランチは使用しません（削除済み）

### ブランチ命名規則

新しい作業は必ず `main` から分岐してください：

```bash
git checkout main
git pull origin main
git checkout -b <prefix>/<issue番号>-<簡潔な説明>
```

| プレフィックス | 用途 | 例 |
|---|---|---|
| `feature/` | 新機能 | `feature/issue-3-summary-improvement` |
| `fix/` | バグ修正 | `fix/issue-2-recording-controls` |
| `refactor/` | リファクタリング | `refactor/api-error-handling` |
| `docs/` | ドキュメント | `docs/update-readme` |
| `chore/` | 設定・CI/CD | `chore/add-eslint-rules` |

### 禁止事項

- ❌ `main` への直接プッシュ
- ❌ `master` ブランチの作成
- ❌ ブランチをフォークして別の Git 履歴を作成

## 開発フロー

### 1. Issue の確認

作業前に必ず GitHub Issue を確認し、担当を割り当ててください。

### 2. ブランチ作成

```bash
git checkout main
git pull origin main
git checkout -b feature/issue-X-description
```

### 3. ローカル開発

```bash
# Web（Next.js）
cd web
npm install
npm run dev

# API（Azure Functions）
cd api
npm install
npm run build
```

### 4. ビルド検証（PR 前に必須）

```bash
# Web のビルド検証
cd web
npm run lint          # ESLint
npx tsc --noEmit      # TypeScript 型チェック
npm run build         # Next.js ビルド

# API のビルド検証
cd api
npx tsc --noEmit      # TypeScript 型チェック
npm run build         # コンパイル
```

### 5. コミット & プッシュ

```bash
git add .
git commit -m "<type>: <簡潔な説明>"
git push origin feature/issue-X-description
```

コミットメッセージの種類：
- `feat:` 新機能
- `fix:` バグ修正
- `refactor:` リファクタリング
- `docs:` ドキュメント
- `chore:` CI/CD・設定変更
- `style:` コードスタイル変更

### 6. Pull Request 作成

```bash
gh pr create --base main --title "<type>: 説明" --body "関連 Issue: #X"
```

PR には以下を含めてください：
- 変更内容の概要
- 関連する Issue 番号
- ビルド検証の結果（成功していること）
- テスト方法（該当する場合）

### 7. マージ

- PR は **スカッシュマージ** を推奨
- マージ後、フィーチャーブランチは自動削除

## プロジェクト構成

```
airecorder/
├── .github/
│   ├── agents/          # AI エージェント定義
│   └── workflows/       # GitHub Actions CI/CD
├── api/                 # Azure Functions (TypeScript)
│   └── src/
│       ├── functions/   # HTTP トリガー関数
│       ├── models/      # データモデル
│       ├── services/    # ビジネスロジック
│       └── utils/       # ユーティリティ
├── web/                 # Next.js フロントエンド
│   ├── docs/            # 設計ドキュメント
│   ├── scripts/         # デプロイスクリプト
│   └── src/
│       ├── app/         # App Router ページ
│       ├── components/  # UI コンポーネント
│       ├── contexts/    # React Context
│       ├── hooks/       # カスタムフック
│       ├── lib/         # ライブラリ
│       ├── services/    # API クライアント
│       └── types/       # 型定義
```

## CI/CD パイプライン

| ワークフロー | トリガー | 内容 |
|---|---|---|
| PR Build Verification | PR → main | web/api のビルド検証 |
| Azure SWA CI/CD | push to main | フロントエンドデプロイ |
| Azure Functions CI/CD | push to main (api/**) | バックエンドデプロイ + ヘルスチェック検証 |
| Azure Infra Health Check | 毎日 JST 9:00 / 手動 | Azure設定の異常検知 |

## ⚠️ Azure インフラ設定 — 絶対に変更してはいけない項目

以下の Azure 設定は CI/CD の動作に直結します。**変更すると本番デプロイが完全に停止します。**

### 1. SCM Basic Auth（基本認証）→ **有効のまま維持**

| 項目 | 正しい値 |
|---|---|
| `basicPublishingCredentialsPolicies/scm` | `allow: true` |
| `basicPublishingCredentialsPolicies/ftp` | `allow: true` |

**変更した場合の影響**: Publish Profile を使った CI/CD デプロイが 401 エラーで失敗  
**復旧方法**:
```bash
az rest --method PUT \
  --url "https://management.azure.com/subscriptions/{subId}/resourceGroups/rg-airecorder-dev/providers/Microsoft.Web/sites/func-airecorder-dev/basicPublishingCredentialsPolicies/scm?api-version=2022-03-01" \
  --body '{"properties":{"allow":true}}'
```

### 2. EasyAuth（App Service 認証）→ **無効のまま維持**

| 項目 | 正しい値 |
|---|---|
| 認証 (Authentication) | 無効 |
| `platform.enabled` | `false` |

**変更した場合の影響**: 全 API リクエストが認証要求（401/302）で失敗  
**復旧方法**: Azure Portal → Functions App → 認証 → 無効化

### 3. Publish Profile（GitHub Secret）

| 項目 | 説明 |
|---|---|
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Functions デプロイ用認証情報 |

**SCM Basic Auth を無効→有効に戻した場合**: Publish Profile の再取得 & Secret の更新が必要
```bash
az functionapp deployment list-publishing-profiles --name func-airecorder-dev --resource-group rg-airecorder-dev --xml > profile.xml
gh secret set AZURE_FUNCTIONAPP_PUBLISH_PROFILE < profile.xml
```

### 過去のインシデント

| 日付 | 問題 | 原因 | 影響時間 |
|---|---|---|---|
| 2026-02-08 | Functions CI/CD デプロイ 401 失敗 | SCM Basic Auth が `allow: false` に設定されていた | 〜2時間 |
| 2026-02-08 | 全API 401 Unauthorized | EasyAuth が誤って有効化されていた | 〜3時間 |

## コーディング規約

- TypeScript strict モード
- ESLint ルールに従う
- ライトモードのみ対応（ダークモード不要）
- UI に絵文字を使用しない
- API レスポンスは安全な JSON パース（`response.text()` + `JSON.parse()`）を使用
