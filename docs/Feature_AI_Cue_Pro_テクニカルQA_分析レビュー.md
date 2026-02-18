# AI Cue Pro — テクニカルQ&A with Citations 分析レビュー

## 1. エグゼクティブサマリー

**現在のAI Cues（Issue #89）を大幅に拡張し、録音中に相手の技術的質問をリアルタイムで検出→Web検索→根拠付き回答を自動生成する機能。**

- **影響範囲**: テクニカルサポートエンジニア・面接者など、リアルタイムで技術的回答が求められる全ユーザー（推定ヘビーユーザー層の60%以上）
- **修正の緊急度**: P2（戦略的差別化機能 — 競合製品に完全非搭載）

### ユーザーの具体的ユースケース

| シナリオ | 状況 | 期待する動作 |
|---------|------|-------------|
| **テクニカルサポート会議** | お客様から「このAPIのレート制限はいくつ？」等の質問 | AIが裏でBing検索→公式ドキュメントのリンク付きで回答を表示 |
| **エンジニア面接** | 面接官から「CAPの定理について説明して」等の技術質問 | AIが即座にWikipedia/技術ブログの根拠付きで回答を表示 |

---

## 2. アーキテクチャ概観

### 2.1 現在のAI Cues（Issue #89）アーキテクチャ

```
[マイク] → [Speech SDK] → [確定セグメント (segments[])]
                                    │
                                    └──→ [useAICues] ─── バッチ(5seg) + デバウンス(5s) ───→ POST /api/cues/generate
                                                                                              │
                                                                                              ▼
                                                                                     Azure OpenAI GPT-4o-mini
                                                                                     (LLM知識のみ、検索なし)
                                                                                              │
                                                                                              ▼
                                                                                     3種類のCueカード:
                                                                                     ├─ 💡 Concept (用語解説)
                                                                                     ├─ 👤 Bio (人物情報)
                                                                                     └─ 💬 Suggestion (回答案)
```

### 2.2 提案するAI Cue Pro アーキテクチャ

```
[マイク] → [Speech SDK] → [確定セグメント (segments[])]
                                    │
                                    ├──→ [useAICues] (既存: concept/bio/suggestion)
                                    │
                                    └──→ 【NEW】[useDeepAnswer]
                                              │
                                              ├─ 質問検出ロジック（「〜とは？」「〜について教えて」等）
                                              ├─ 手動トリガーボタン 🔍
                                              │
                                              ▼
                                         POST /api/cues/deep-answer 【NEW】
                                         { question, context[], language, mode }
                                              │
                                              ├── Step 1: Bing Search API v7 で Web 検索
                                              │            → 上位5件の検索結果取得
                                              │
                                              ├── Step 2: 検索結果 + 会話文脈を
                                              │            Azure OpenAI GPT-5-mini に送信
                                              │            → RAG (Retrieval-Augmented Generation)
                                              │
                                              ▼
                                         回答 + Citations を返却
                                              │
                                              ▼
                                    【NEW】[AnswerCard] UI
                                         ├─ 📋 質問テキスト
                                         ├─ 📝 詳細回答（Markdown対応）
                                         ├─ 🔗 引用リンク [1][2][3]...
                                         └─ 📋 コピーボタン
```

### 2.3 データフロー詳細

```
┌─────────────────────────────────────────────────────────────────┐
│                     フロントエンド                               │
│                                                                 │
│  useDeepAnswer Hook                                             │
│  ├─ segments 監視 → 質問パターン検出                             │
│  │   "〜とは？" "What is〜?" "〜の違いは？" "How to〜?"          │
│  ├─ OR 手動トリガー（ユーザーが質問文を入力/選択）                │
│  │                                                              │
│  ├─ mode: "tech_support" | "interview" | "general"              │
│  │   (設定画面で選択)                                            │
│  │                                                              │
│  └─→ POST /api/cues/deep-answer                                 │
│       { question, segments(context), language, mode }            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     バックエンド (Azure Functions)               │
│                                                                 │
│  /api/cues/deep-answer                                          │
│  │                                                              │
│  ├─ Step 1: Bing Web Search API v7                              │
│  │   GET https://api.bing.microsoft.com/v7.0/search             │
│  │   ?q={question}&count=5&mkt={language}                       │
│  │   → webPages.value[]: { name, url, snippet }                 │
│  │                                                              │
│  ├─ Step 2: Azure OpenAI GPT-5-mini (RAG)                       │
│  │   System: "テクニカルアシスタント + mode別指示"                │
│  │   User: question + 会話文脈 + Bing検索結果                    │
│  │   → 回答テキスト + [1][2]形式の引用番号                       │
│  │                                                              │
│  └─ Response:                                                   │
│       { answer, citations: [{title, url, snippet}], mode }      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 現在のAI Cuesとの差分分析 🔴

### GAP-1: 回答の深さが不足 🔴 Critical

**現在**:
- [cues.ts](../api/src/functions/cues.ts#L88) — `各フィールド50文字以内推奨`
- `suggestion` タイプは質問+回答案+根拠を各1-2文で返す
- GPT-4o-mini を使用（軽量だが深い推論に不向き）
- `max_tokens: 1500`（全Cue合計）

**ユーザーの期待**:
- テクニカルサポート: 公式ドキュメント相当の詳細な技術回答
- 面接: 概念の正確な説明 + 具体例 + ベストプラクティス

**方針**: AI Cue Pro では **GPT-5-mini**（申請不要で最高性能のGAモデル、推論対応、400Kコンテキスト）を使用し、Bing Search APIの検索結果をグラウンディングとしたRAGで深い回答を生成する

### GAP-2: Web検索・根拠情報の欠如 🔴 Critical

**現在**:
- [cues.ts](../api/src/functions/cues.ts#L160-L170) — LLMの訓練データのみに依存
- 引用リンク(URL)は一切返さない
- ハルシネーション（幻覚）リスクが高い

**ユーザーの期待**:
- 「出した回答に対してのリンクとかもしっかり出してくれるように」
- 公式ドキュメント / MDN / Stack Overflow 等の信頼できるソースへのリンク

**影響**: 根拠なしの回答はお客様や面接官に対して信頼性が低く、実務では使えない

### GAP-3: ユースケース別のモード切替が不在 🟡 High

**現在**:
- [cues.ts](../api/src/functions/cues.ts#L56) — 汎用的な会議アシスタントプロンプトのみ
- 「会議中のリアルタイムアシスタント」という単一ペルソナ

**ユーザーの期待**:
- テクニカルサポート: 製品知識 + トラブルシューティング手順 + 公式リンク
- 面接: 概念説明 + 設計パターン + トレードオフ分析

### GAP-4: 手動トリガーの不在 🟡 Medium

**現在**:
- [useAICues.ts](../web/src/hooks/useAICues.ts#L8-L11) — 5セグメントバッチ + 5秒デバウンスの自動トリガーのみ
- ユーザーが「今のこの質問を調べて！」と指定する手段がない

**ユーザーの期待**:
- お客様の質問をリアルタイムで検出して自動的に調べてほしい
- 必要に応じて手動でも質問を入力して検索したい

---

## 4. 設計上の考慮事項 🟡

### 4.1 既存AI Cuesとの共存

✅ **Good**: 現在のAI Cues（concept/bio/suggestion）は軽量で高速（GPT-4o-mini, 1500 tokens）。これは維持すべき。

**方針**: AI Cue Pro（deep-answer）は既存の3タイプに **追加する4つ目のタイプ** として実装。両方が同時に動作可能。

### 4.2 コスト管理

| 項目 | 現在のAI Cues | AI Cue Pro (deep-answer) |
|------|--------------|--------------------------|
| LLMモデル | GPT-4o-mini | GPT-5-mini（申請不要で最高性能） |
| max_tokens | 1,500 | 3,000〜4,000 |
| 外部API | なし | Bing Search API v7 |
| 1回の推定コスト | ~$0.002 | ~$0.01 + $0.005(Bing) |
| セッション上限 | 20回/録音 | 10回/録音（推奨） |

### 4.3 レイテンシ

| ステップ | 推定時間 |
|---------|---------|
| 質問検出（ローカル） | <100ms |
| Bing Search API | 300-800ms |
| Azure OpenAI GPT-5-mini (RAG) | 2-5秒 |
| **合計** | **3-6秒** |

→ テクニカルサポートやの会議中であれば3-6秒は許容範囲（「ちょっと確認しますね」と言える時間）

### 4.4 Bing Search API の選定理由

| 選択肢 | Pros | Cons | 判定 |
|--------|------|------|------|
| **Bing Web Search API v7** | シンプル、Azure統合、低コスト($5/1000クエリ) | 設定追加が必要 | ✅ 採用 |
| Azure AI Search + Data Source | Azure OpenAI統合済み、citations自動 | 自前データのみ（Web検索不可） | ❌ |
| Google Custom Search API | 検索品質高い | Azure外、100クエリ/日制限 | ❌ |
| OpenAI Web Browsing | 統合的 | Azure OpenAIでは非対応 | ❌ |

---

## 5. 依存関係マトリクス 📊

### 5.1 既存機能との依存

| コンポーネント | 依存元 | 影響 | 対策 |
|---------------|--------|------|------|
| `useAICues` Hook | segments, isRecording | 共存 — 新Hookは追加で動作 | 独立したHookとして実装 |
| `AICuesPanel` | cues配列 | 新しいAnswerCue型を追加描画 | CueCard にAnswerCard分岐追加 |
| UserSettings | enableAICues | 新設定 `aiCueMode` を追加 | 後方互換あり（デフォルト: "general"） |
| 設定画面 | settings | モード選択UI追加 | 既存のAI Cuesトグルの下に追加 |

### 5.2 新規外部依存

| 依存先 | 種類 | リスク | 対策 |
|--------|------|--------|------|
| Bing Web Search API v7 | Azure Marketplace | APIキー管理、レート制限 | env変数、リトライ、フォールバック |
| GPT-5-mini（申請不要モデル） | Azure OpenAI | レイテンシ | セッション上限、推論effort調整 |

### 5.3 他Issue/機能との相互作用

- **Issue #89 (AI Cues)**: ベース機能 — 共存設計
- **Issue #126 (リアルタイムAI補正)**: 独立 — 干渉なし
- **Issue #125 (翻訳テキストAI補正)**: 独立 — 干渉なし
- **Issue #84 (API使用量表示)**: deep-answerのAPI使用量も表示対象に含める必要あり

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Desktop (Chrome/Edge/Firefox) | ✅ 問題なし | — |
| Mobile (iOS Safari) | ⚠️ サイドパネルが非表示（`hidden lg:flex`） | モバイル用UI検討が必要 |
| Node.js (API側) | ✅ 問題なし — fetch + AzureOpenAI SDK | — |
| Bing Search API | ✅ サーバーサイドのみ | APIキー露出リスクなし |

---

## 7. 修正提案（優先順位付き）

### Phase 1: MVP — Deep Answer 基本実装（P0）

#### 7.1 新しいバックエンドAPI: `api/src/functions/deepAnswer.ts`

```typescript
// POST /api/cues/deep-answer
interface DeepAnswerRequest {
  question: string;         // 検出された質問 or ユーザー入力
  segments: string[];       // 会話の文脈（直近セグメント）
  language: string;         // "ja-JP" | "en-US" etc.
  mode: "tech_support" | "interview" | "general";
}

interface Citation {
  title: string;
  url: string;
  snippet: string;
}

interface DeepAnswerResponse {
  answer: string;           // Markdown形式の詳細回答
  citations: Citation[];    // 引用元リンク
  searchQuery: string;      // 実際に検索したクエリ
}

// 処理フロー:
// 1. Bing Web Search API v7 で question を検索
// 2. 上位5件の結果を取得
// 3. GPT-5-mini に 会話文脈 + 検索結果 + mode別プロンプトを送信
// 4. [1][2]形式の引用番号付き回答を生成
// 5. citations と共に返却
```

#### 7.2 mode別システムプロンプト

```typescript
const MODE_PROMPTS = {
  tech_support: `あなたはテクニカルサポートエンジニアのアシスタントです。
お客様からの技術的質問に対して:
- 正確で具体的な回答を提供してください
- 手順がある場合はステップバイステップで説明してください
- 公式ドキュメントの情報を優先してください
- 回答中で参照した情報には [1], [2] 等の引用番号を付けてください
- 不確実な情報は明示してください`,

  interview: `あなたはエンジニア面接のアシスタントです。
面接官の技術質問に対して:
- 概念を正確に、かつ簡潔に説明してください
- 具体的な使用例やユースケースを含めてください
- 類似概念との違い（比較）を示してください
- ベストプラクティスや注意点があれば言及してください
- 回答中で参照した情報には [1], [2] 等の引用番号を付けてください`,

  general: `あなたは会議中のリアルタイムアシスタントです。
質問に対して正確で実用的な回答を提供してください。
回答中で参照した情報には [1], [2] 等の引用番号を付けてください。`
};
```

#### 7.3 新しい型定義: `AnswerCue`

```typescript
// web/src/types/index.ts に追加

export interface Citation {
  title: string;
  url: string;
  snippet: string;
}

export interface AnswerCue extends BaseCue {
  type: "answer";
  question: string;
  answer: string;           // Markdown形式
  citations: Citation[];
  mode: "tech_support" | "interview" | "general";
}

// AICue ユニオン型を拡張
export type AICue = ConceptCue | BioCue | SuggestionCue | AnswerCue;
export type CueType = "concept" | "bio" | "suggestion" | "answer";
```

#### 7.4 新しいフック: `useDeepAnswer`

```typescript
// web/src/hooks/useDeepAnswer.ts (新規)
// - 質問の自動検出: segments内の疑問パターンをマッチング
// - 手動トリガー: triggerDeepAnswer(question) を公開
// - デバウンス: 同一質問の重複検索を防止
// - セッション上限: 10回/録音
```

#### 7.5 新しいUIコンポーネント: `AnswerCard`

```tsx
// AnswerCard: 紫色のカード
// ├─ ❓ 質問テキスト
// ├─ 📝 回答（Markdown → ReactMarkdown で描画）
// ├─ 🔗 引用リンクリスト
// │    [1] Azure公式ドキュメント - https://learn.microsoft.com/...
// │    [2] Stack Overflow - https://stackoverflow.com/...
// ├─ 📋 回答コピーボタン
// └─ 🔍 モードバッジ（Tech Support / Interview）
```

### Phase 2: UX改善（P1）

- 質問入力フィールド（手動で質問を入力して検索）
- 回答のストリーミング表示（SSE）
- 回答履歴の保持（録音終了後も参照可能）
- モバイル対応（ボトムシート or フルスクリーンモーダル）

### Phase 3: 高度な機能（P2）

- 質問の自動カテゴリ分類（技術/ビジネス/手続き）
- 過去の回答のキャッシュ（同一質問の高速応答）
- カスタムナレッジベース連携（Azure AI Search + 自社ドキュメント）
- 回答品質のフィードバック機能（👍/👎）

---

## 8. テスト戦略

### 8.1 ユニットテスト

| テスト対象 | テストケース |
|-----------|-------------|
| 質問検出ロジック | 「〜とは？」「What is〜?」「〜の違い」等のパターンマッチ |
| Bing API呼び出し | 正常系、タイムアウト、429エラー、空結果 |
| GPT-5-mini RAG | 引用番号の正確性、Markdown形式の妥当性 |
| セッション上限 | 11回目の呼び出しがブロックされること |

### 8.2 統合テスト

| シナリオ | 期待結果 |
|---------|---------|
| 「Kubernetesのpodとnodeの違いは？」 | 正確な比較回答 + kubernetes.io等のリンク |
| 「AzureのApp ServiceとFunctionsの料金体系は？」 | 料金情報 + learn.microsoft.comリンク |
| ネットワーク切断時 | エラーメッセージ表示、既存Cuesは影響なし |
| Bing API障害時 | フォールバック（LLM知識のみで回答 + 警告表示） |

### 8.3 手動テスト

| テスト | 確認事項 |
|-------|---------|
| tech_supportモード | 公式ドキュメントリンクが優先的に含まれること |
| interviewモード | 概念説明 + 比較 + 例が含まれること |
| 日本語質問 | 日本語で回答、リンクは言語問わず |
| 英語質問 | 英語で回答 |
| 3-6秒のレイテンシ | ローディング表示が適切であること |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | 型定義追加（AnswerCue, Citation, CueType拡張） | 0.5h | types/index.ts |
| 2 | Bing Search APIサービス（api/src/services/bingSearch.ts） | 1h | 新規ファイル |
| 3 | deep-answer API エンドポイント（api/src/functions/deepAnswer.ts） | 2h | 新規ファイル |
| 4 | フロントエンドAPIクライアント（web/src/services/cuesApi.ts拡張） | 0.5h | 既存ファイル |
| 5 | useDeepAnswer Hook（web/src/hooks/useDeepAnswer.ts） | 2h | 新規ファイル |
| 6 | AnswerCard UIコンポーネント | 2h | AICuesPanel.tsx拡張 |
| 7 | UserSettings拡張 + 設定画面UI | 1h | settings/page.tsx, types |
| 8 | page.tsx統合（Hook呼び出し + パネル連携） | 1h | page.tsx |
| 9 | i18n メッセージ追加 | 0.5h | messages/*.json |
| 10 | Azure環境変数設定（BING_SEARCH_API_KEY等） | 0.5h | 環境設定 |
| **合計** | | **11h** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Bing Search APIのレート制限超過 | 低 | 高 | セッション上限10回、429時リトライ |
| GPT-5-miniのレイテンシ（>5秒） | 中 | 中 | reasoning_effort調整（none〜medium）、ローディングUI |
| 回答のハルシネーション | 低 | 高 | Bing検索結果をグラウンディングに使用、引用必須 |
| Bing APIコスト増大 | 低 | 低 | $5/1000クエリ、上限設定で制御可能 |
| モバイルでのUI表示 | 中 | 中 | Phase 2でモバイル対応、Phase 1はデスクトップのみ |
| 既存AI Cuesへの影響 | 極低 | 高 | 完全独立実装、共通パネルでの表示のみ共有 |

---

## 11. 結論

### 最大の問題点

現在のAI Cues は **「簡潔な概要レベルのヒント」** にとどまっており、テクニカルサポートや面接のような **「正確性と根拠が求められる場面」** では全く実用に耐えない。

### 推奨する修正順序

1. **Phase 1 (MVP)**: Bing Search + GPT-5-mini RAGによるDeep Answer機能（新エンドポイント + 新Hook + AnswerCard UI）
2. **Phase 2**: ストリーミング表示、手動質問入力、モバイル対応
3. **Phase 3**: カスタムナレッジベース、キャッシュ、フィードバック

### 他Issueへの影響

- Issue #84（API使用量表示）: deep-answerのBing API + GPT-5-mini使用量もカウント対象に含める必要あり
- 既存Issue #89のコードには**破壊的変更なし**

### 判定: `GO` ✅

技術的に実現可能（Azure OpenAI + Bing Search APIの組み合わせ）であり、競合製品に完全非搭載の差別化機能。既存のAI Cues基盤を活用できるため、実装リスクは低い。
