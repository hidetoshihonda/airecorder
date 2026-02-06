This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 🚀 クイックスタート

### 1. 環境変数の設定

```bash
# テンプレートをコピー
cp .env.example .env.local
```

**自動設定（推奨）:**
```powershell
.\scripts\deploy.ps1 -AutoFix
```

**手動設定:** `.env.local` を編集して以下を設定:

| 変数名 | 説明 | 取得コマンド |
|--------|------|-------------|
| `NEXT_PUBLIC_AZURE_SPEECH_KEY` | Speech Services APIキー | `az cognitiveservices account keys list --name speech-airecorder-dev --resource-group rg-airecorder-dev --query key1 -o tsv` |
| `NEXT_PUBLIC_AZURE_SPEECH_REGION` | Speech Services リージョン | 通常 `japaneast` |
| `NEXT_PUBLIC_AZURE_TRANSLATOR_KEY` | Translator APIキー | `az cognitiveservices account keys list --name translator-airecorder-dev --resource-group rg-airecorder-dev --query key1 -o tsv` |
| `NEXT_PUBLIC_AZURE_TRANSLATOR_REGION` | Translator リージョン | **⚠️ 通常 `global`（重要！）** |
| `NEXT_PUBLIC_API_URL` | API URL | `https://func-airecorder-dev.azurewebsites.net/api` |

### 2. 開発サーバー起動

```bash
npm run dev
```

### 3. デプロイ

```powershell
# 検証付きデプロイ（推奨）
.\scripts\deploy.ps1

# 環境変数を自動取得してデプロイ
.\scripts\deploy.ps1 -AutoFix

# ビルド済みの場合
.\scripts\deploy.ps1 -SkipBuild
```

## ⚠️ よくある問題

### 翻訳エラー 401
**原因**: Translator のリージョン設定が間違っている
**解決**: `NEXT_PUBLIC_AZURE_TRANSLATOR_REGION=global` に設定

### API設定エラー
**原因**: `.env.local` が未設定またはビルドに含まれていない
**解決**: `.env.local` を設定後、再ビルド＆再デプロイ

### 録音が保存されない
**原因**: 「保存」ボタンを押していない
**解決**: 録音停止後、「保存」ボタンをクリック

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
