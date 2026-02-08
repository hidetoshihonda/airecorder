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
| Azure Functions CI/CD | push to main (api/**) | バックエンドデプロイ |

## コーディング規約

- TypeScript strict モード
- ESLint ルールに従う
- ライトモードのみ対応（ダークモード不要）
- UI に絵文字を使用しない
- API レスポンスは安全な JSON パース（`response.text()` + `JSON.parse()`）を使用
