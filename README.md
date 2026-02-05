# 🎙️ Azure AI Voice Recorder & Real-time Translator

AIボイスレコーダー＆リアルタイム翻訳アプリ

## 📋 概要

TALIX & DingTalk A1のようなAIボイスレコーダー機能を、Azureクラウドサービスを活用してソフトウェアベースで実現するWebアプリケーションです。

### 主な機能

- 🎤 **音声録音** - ブラウザでリアルタイム音声録音
- 📝 **リアルタイム文字起こし** - Azure Speech Services による高精度な音声認識
- 🌍 **10言語対応翻訳** - Azure Translator によるリアルタイム翻訳
- 📄 **AI議事録生成** - Azure OpenAI による自動要約・議事録作成
- ☁️ **クラウド保存** - Azure Blob Storage への安全なデータ保存

### 対応言語

| 言語 | コード |
|------|--------|
| 日本語 | ja-JP |
| 英語 | en-US |
| スペイン語 | es-ES |
| 中国語（簡体） | zh-CN |
| 韓国語 | ko-KR |
| フランス語 | fr-FR |
| ドイツ語 | de-DE |
| ポルトガル語 | pt-BR |
| イタリア語 | it-IT |
| アラビア語 | ar-SA |

## 🛠️ 技術スタック

### フロントエンド
- Next.js 15 (App Router)
- React 19
- TypeScript 5.7
- Tailwind CSS
- Radix UI

### バックエンド
- Azure Functions (Node.js 20)
- Azure Speech Services
- Azure Translator
- Azure OpenAI Service

### インフラ
- Azure App Service (Docker)
- Azure Container Registry
- Azure Blob Storage
- Azure Cosmos DB
- Azure AD B2C

## 🚀 Getting Started

### 必要条件

- Node.js 20 LTS
- Docker Desktop
- Azure CLI
- Azure サブスクリプション

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/hidetoshihonda/airecorder.git
cd airecorder

# 依存関係のインストール
cd web
npm install

# 環境変数の設定
cp .env.local.example .env.local

# 開発サーバーの起動
npm run dev
```

### Docker での起動

```bash
docker-compose up -d
```

## 📁 プロジェクト構成

```
airecorder/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── web/                    # Next.js フロントエンド
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── services/
│   │   └── types/
│   ├── Dockerfile
│   └── package.json
├── api/                    # Azure Functions
├── docker-compose.yml
└── README.md
```

## 📝 ライセンス

MIT License

## 👥 Author

- [@hidetoshihonda](https://github.com/hidetoshihonda)
