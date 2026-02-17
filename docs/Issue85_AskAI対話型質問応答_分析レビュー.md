# Issue #85: Ask AI 録音内容への対話型AI質問応答 — 分析レビュー

## 1. エグゼクティブサマリー

- **本質**: 録音の文字起こしデータに対してチャット形式で質問し、AIが文脈を踏まえて回答する対話型Q&A機能。競合6/10製品が搭載する最重要機能。
- **影響範囲**: 全ユーザー（録音詳細画面を使う100%のユーザー）が恩恵を受ける新機能。既存機能への破壊的変更なし。
- **緊急度**: Medium（P3ラベルだが、競合標準キャッチアップ Phase 2 の最重要機能）

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
┌─────────────────────────────────────────────────────────┐
│ recording/page.tsx (録音詳細画面)                         │
│  ├── Tabs: transcript | translation | summary | askAi   │  ← 新規タブ追加
│  │         (文字起こし) (翻訳)     (議事録)  (Ask AI)    │
│  └── AskAiPanel.tsx ← 新規コンポーネント                  │
│       ├── ChatMessageList (メッセージ一覧)                │
│       ├── ChatInput (質問入力)                            │
│       └── SuggestedQuestions (質問例)                     │
├─────────────────────────────────────────────────────────┤
│ hooks/useAskAi.ts ← 新規フック                           │
│  ├── SSE ストリーミング管理                               │
│  ├── 会話履歴管理 (useState)                             │
│  └── AbortController (キャンセル)                        │
├─────────────────────────────────────────────────────────┤
│ services/askAiApi.ts ← 新規サービス                      │
│  └── POST /api/recordings/{id}/ask (SSE)                │
├─────────────────────────────────────────────────────────┤
│ api/src/functions/askAi.ts ← 新規エンドポイント           │
│  ├── Azure OpenAI Chat Completion (streaming)           │
│  ├── 録音データ取得 (CosmosDB)                           │
│  └── transcript をシステムコンテキストに設定              │
└─────────────────────────────────────────────────────────┘
```

### 2.2 データフロー

```
[ユーザー質問入力]
    │
    ▼
[useAskAi Hook] → POST /api/recordings/{id}/ask
    │               Body: { question, conversationHistory, userId }
    │
    ▼
[askAi.ts API Endpoint]
    ├── CosmosDB: getRecording(id, userId) → transcript 取得
    ├── transcript + conversationHistory → Azure OpenAI メッセージ構築
    │   ├── system: "以下の文字起こし内容に基づいて回答" + transcript
    │   ├── ...conversationHistory (user/assistant 交互)
    │   └── user: question
    ├── Azure OpenAI Chat Completion (stream: true)
    └── SSE レスポンス → クライアントへストリーミング
         │
         ▼
    [AskAiPanel] リアルタイム表示
```

### 2.3 状態管理の構造

| State | 管理場所 | 説明 |
|-------|---------|------|
| `messages` | useAskAi hook (useState) | 会話履歴 Message[] |
| `isStreaming` | useAskAi hook (useState) | ストリーミング中フラグ |
| `error` | useAskAi hook (useState) | エラーメッセージ |
| `streamingContent` | useAskAi hook (useRef) | ストリーム中の部分テキスト |

---

## 3. 重大バグ分析 🔴

### 新規機能のため既存バグはなし

本 Issue は新機能追加であり、既存コードにバグはありません。以下は実装時に注意すべきリスクです。

### RISK-1: トランスクリプトのトークン制限超過
**影響**: Critical  
**問題**: Azure OpenAI の `gpt-4o-mini` は 128K コンテキストだが、長時間録音（2時間以上）の transcript が 50,000〜100,000 文字に達する可能性がある。system プロンプトに全文を載せるとトークン制限に近づく。  
**対策**: 
- transcript の文字数を制限（例: 最大 80,000 文字、超過時は末尾を優先的に切り捨て）
- `max_tokens` を応答用に十分確保（4,096）
- 長文の場合はユーザーに警告表示

### RISK-2: SSE 接続のリソースリーク
**影響**: High  
**問題**: SSE ストリーミング中にユーザーがページ遷移・タブ切替した場合、接続が残る可能性。  
**対策**: 
- AbortController で fetch をキャンセル
- useEffect の cleanup で abort()
- コンポーネント unmount 時にストリーム切断

### RISK-3: 会話履歴の肥大化
**影響**: Medium  
**問題**: 長い会話を続けるとconversationHistory が肥大化し、API リクエストのペイロードが巨大になる。  
**対策**: 
- 直近N件（例: 10ターン=20メッセージ）のみ送信
- 古いメッセージはクライアント側に保持するがAPIには送らない

---

## 4. 設計上の考慮点 🟡

### 4.1 タブ vs サイドパネル

**選択肢A: 4つ目のタブとして追加**
- ✅ 既存の Tabs 構造に自然に統合
- ✅ 画面スペースを最大活用
- ❌ 文字起こし・議事録を見ながら質問できない

**選択肢B: サイドパネル/ドロワー**
- ✅ 文字起こしを見ながら質問可能
- ❌ モバイルでのスペース問題
- ❌ 実装が複雑

**推奨: 選択肢A（タブ）** — 既存パターンに合致し、最もシンプル。将来的にサイドパネル化は可能。

### 4.2 SSE vs WebSocket vs ポーリング

**推奨: SSE (Server-Sent Events)**
- Issue の想定設計と一致
- Azure Functions で実装可能（HTTP ストリーミング）
- 一方向通信で十分（サーバー→クライアント）
- fetch API の ReadableStream で実装可能

### 4.3 会話履歴の永続化

**選択肢A: クライアント側のみ（useState）**
- ✅ シンプル、サーバー変更不要
- ❌ ページリロードで消える

**選択肢B: CosmosDB に保存**
- ✅ 永続的
- ❌ DB スキーマ変更が必要
- ❌ 工数増大

**推奨: 選択肢A（クライアント側）** — MVP として十分。将来的に永続化は Phase 2 で検討。

### 4.4 ✅ Good: 既存の API パターン

既存の `summary.ts`, `cues.ts`, `realtimeCorrection.ts` が一貫したパターン（Azure OpenAI + jsonResponse + CORS）で実装されており、新規エンドポイントも同じパターンで実装できる。

### 4.5 ✅ Good: Recording データモデル

`Recording` 型に `transcript`, `correctedTranscript`, `speakerLabels` が揃っており、Ask AI のコンテキストとして十分なデータが利用可能。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #85 (Ask AI) は独立して実装可能
  └── 依存なし（既存の Recording + transcript データを利用）
```

- ブロッカーなし
- 並行作業可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| askAi.ts API | Azure OpenAI | Low | 既存と同じ接続パターン |
| askAi.ts API | CosmosDB (getRecording) | Low | 既存の recordingService を再利用 |
| AskAiPanel.tsx | recording/page.tsx | Low | Tabs に1タブ追加のみ |
| SSE ストリーミング | Azure Functions HTTP | Medium | Azure Functions v4 は HTTP streaming 対応済み |

### 5.3 他 Issue/機能との相互作用

| 関連 Issue | 相互作用 | 影響 |
|-----------|---------|------|
| #70 (LLM文字起こし補正) | Ask AI は correctedTranscript を優先的に使用すべき | 正の相互作用 |
| #126 (リアルタイムAI補正) | 録音後の Ask AI では補正済みテキストを使用 | 正の相互作用 |
| #147 (話者ラベル編集) | speakerLabels を transcript に反映して Ask AI に渡す | 正の相互作用 |
| #125 (翻訳テキスト保存後AI補正) | Ask AI は原語 transcript のみ対象（翻訳は対象外） | 中立 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome / Edge | ReadableStream + TextDecoder ✅ | Low |
| Firefox | ReadableStream ✅ | Low |
| Safari / iOS | ReadableStream ✅ (Safari 14.1+) | Low |
| モバイル全般 | チャットUI のレスポンシブ対応必要 | Medium |
| Azure Functions v4 | HTTP streaming 対応済み | Low |

---

## 7. 修正提案（優先順位付き）

### Phase 1: コア機能実装（P0）

#### 7.1 バックエンド: API エンドポイント

**新規ファイル**: `api/src/functions/askAi.ts`

```typescript
// POST /api/recordings/{recordingId}/ask
// Body: { question: string, conversationHistory: Message[], userId: string }
// Response: SSE stream (text/event-stream)

// 実装方針:
// 1. userId + recordingId で CosmosDB から Recording 取得
// 2. transcript (correctedTranscript 優先) を system プロンプトに設定
// 3. conversationHistory + question を messages に追加
// 4. Azure OpenAI Chat Completion (stream: true)
// 5. ReadableStream で SSE レスポンスを返す
```

**システムプロンプト設計**:
```
あなたは会議の録音内容について質問に答えるアシスタントです。
以下の文字起こしデータに基づいて、正確かつ簡潔に回答してください。

【ルール】
1. 文字起こしに記載されていない情報は推測しない
2. 不明な点は「文字起こしからは確認できません」と回答
3. 話者情報がある場合は「[話者名]が〜」のように引用
4. 回答は簡潔に（箇条書き推奨）
5. 質問に応じて適切なフォーマット（表、リスト等）を使用

【文字起こしデータ】
{transcript}
```

#### 7.2 フロントエンド: API サービス

**新規ファイル**: `web/src/services/askAiApi.ts`

```typescript
// SSE ストリーミング対応の API クライアント
// fetchSSE(url, body, onChunk, onDone, onError, signal)
// ReadableStream + TextDecoder でチャンクを処理
```

#### 7.3 フロントエンド: カスタムフック

**新規ファイル**: `web/src/hooks/useAskAi.ts`

```typescript
// useAskAi(recordingId, transcript)
// Returns: { messages, isStreaming, error, sendMessage, clearHistory }
// - sendMessage: 質問を送信し SSE ストリームを開始
// - clearHistory: 会話履歴をクリア
// - AbortController で unmount 時にキャンセル
```

#### 7.4 フロントエンド: UI コンポーネント

**新規ファイル**: `web/src/components/AskAiPanel.tsx`

```
┌─────────────────────────────────┐
│ 🤖 Ask AI                      │
│                                  │
│ ┌─ 質問例 ─────────────────┐   │
│ │ 💡 決定事項をまとめて     │   │
│ │ 💡 〇〇について話した内容│   │
│ │ 💡 次のアクションは？     │   │
│ └──────────────────────────┘   │
│                                  │
│ 🧑 決定事項をまとめてください    │
│                                  │
│ 🤖 以下が会議で決定された事項   │
│    です:                        │
│    1. ○○を来週までに完了       │
│    2. △△の予算を承認           │
│    3. □□の担当を変更           │
│                                  │
│ 🧑 参加者は誰でしたか？         │
│                                  │
│ 🤖 文字起こしから確認できる     │
│    参加者は以下の通りです:      │
│    - Guest-1                    │
│    - Guest-2                    │
│                                  │
│ ┌──────────────────┐ ┌───┐     │
│ │ 質問を入力...     │ │ → │     │
│ └──────────────────┘ └───┘     │
└─────────────────────────────────┘
```

#### 7.5 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `api/src/functions/askAi.ts` | 新規 | SSE ストリーミング API エンドポイント |
| `web/src/services/askAiApi.ts` | 新規 | SSE 対応 API クライアント |
| `web/src/hooks/useAskAi.ts` | 新規 | 会話管理・ストリーミングフック |
| `web/src/components/AskAiPanel.tsx` | 新規 | チャット UI コンポーネント |
| `web/src/app/recording/page.tsx` | 修正 | Ask AI タブ追加 |
| `web/src/hooks/index.ts` | 修正 | useAskAi export 追加 |
| `web/src/services/index.ts` | 修正 | askAiApi export 追加 |
| `web/messages/ja.json` | 修正 | AskAI セクション i18n |
| `web/messages/en.json` | 修正 | AskAI セクション i18n |
| `web/messages/es.json` | 修正 | AskAI セクション i18n |

### Phase 2: UX 改善（P1）

- 会話履歴の永続化（CosmosDB）
- マークダウンレンダリング（コードブロック、表、リスト）
- メッセージのコピーボタン
- レスポンス中のキャンセルボタン
- 文字起こしの該当箇所をハイライト表示

### Phase 3: 堅牢性強化（P2）

- トークン使用量の表示
- レート制限（1分あたりN回）
- 会話のエクスポート機能
- 複数録音を横断した質問（#90 クロスミーティング集計分析と連携）

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|-------------|---------|
| 質問送信 → ストリーミング開始 | isStreaming=true, messages に user メッセージ追加 |
| ストリーミング完了 | isStreaming=false, messages に assistant メッセージ追加 |
| ストリーミング中にエラー | isStreaming=false, error にメッセージ設定 |
| 空の質問を送信 | 送信しない（バリデーション） |
| ストリーミング中に再送信 | 拒否（isStreaming チェック） |
| clearHistory 呼び出し | messages=[], error=null |
| コンポーネント unmount 中のストリーム | AbortController で安全にキャンセル |

### 8.2 統合テスト

| テストケース | モック | 期待結果 |
|-------------|------|---------|
| API 正常応答 | Azure OpenAI ストリーム | SSE チャンクが正しくパースされる |
| Recording 不存在 | CosmosDB | 404 エラー |
| 未認証リクエスト | - | 401 エラー |
| 長大 transcript | 80,000文字超 | 切り詰め＋警告 |
| ネットワーク切断 | fetch throw | エラーメッセージ表示 |

### 8.3 手動テスト

| テストケース | Chrome | Safari | モバイル |
|-------------|--------|--------|---------|
| 通常質問応答 | ○ | ○ | ○ |
| ストリーミング表示 | ○ | ○ | ○ |
| 長い会話（10+ターン） | ○ | ○ | ○ |
| ページ遷移中のストリーム | ○ | ○ | ○ |
| 質問例クリック | ○ | ○ | ○ |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API エンドポイント (askAi.ts) + SSE ストリーミング | 3h | api/ |
| 2 | API サービス (askAiApi.ts) + SSE クライアント | 2h | web/services/ |
| 3 | カスタムフック (useAskAi.ts) | 2h | web/hooks/ |
| 4 | UI コンポーネント (AskAiPanel.tsx) | 3h | web/components/ |
| 5 | recording/page.tsx 統合 (タブ追加) | 1h | web/app/recording/ |
| 6 | i18n メッセージ追加 (ja/en/es) | 0.5h | web/messages/ |
| 7 | ビルド確認・動作テスト | 1h | - |
| **合計** | | **12.5h** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| トークン超過（長時間録音） | Medium | High | transcript 切り詰め + 警告表示 |
| SSE 接続リーク | Low | Medium | AbortController + cleanup |
| Azure Functions SSE 対応問題 | Low | High | HTTP streaming は v4 で対応済み。fallback として非ストリーミングも用意 |
| API コスト増大 | Medium | Medium | セッション制限 + レート制限 |
| 応答品質（ハルシネーション） | Medium | Medium | プロンプトで「文字起こしにないことは推測しない」と制約 |

---

## 11. 結論

- **最大の問題点**: 新規機能のため既存バグはなし。最大のリスクは長時間録音のトークン超過とSSEストリーミングの安定性。
- **推奨する修正順序**: API → サービス → フック → UI → 統合 → i18n（ボトムアップ）
- **他 Issue への影響**: 既存機能への影響なし。#70（補正済みtranscript）と正の相互作用あり。
- **判定**: **GO** — 既存のアーキテクチャパターンに従い、独立して実装可能。競合キャッチアップの最重要機能として優先度を上げることを推奨。

---

## 分析チェックリスト

### コード品質・バグ
- [x] 非同期処理のレースコンディション → SSE ストリーム中の二重送信防止が必要
- [x] リソースリーク → AbortController で fetch 接続を管理
- [ ] クロージャによる古い state 参照 → useRef で最新の messages を参照
- [x] null/undefined チェック → transcript 不存在時のフォールバック
- [x] エラーハンドリング → ネットワークエラー、API エラー、JSON パースエラー
- [x] 型安全性 → Message 型、AskAiRequest 型を定義

### 状態管理
- [x] 状態マシンの有無 → isStreaming boolean で十分（状態は idle/streaming/error の3つ）
- [x] 無効な状態の組み合わせ → isStreaming=true + error は起きない設計
- [x] Rapid click 安全性 → isStreaming 中は送信ボタンを disabled

### アーキテクチャ
- [x] 単一責任原則 → useAskAi = 会話管理、AskAiPanel = UI表示
- [x] 重複コードなし → SSE パースは askAiApi に集約

### API・外部サービス
- [x] API キー → サーバー側のみ（クライアント露出なし）
- [x] ネットワーク切断 → エラーメッセージ表示
- [x] タイムアウト → Azure Functions のデフォルト 230秒で十分

### パフォーマンス
- [x] 不要な re-render → messages 配列の更新最適化（ストリーム中は ref で蓄積、完了時に setState）
- [x] バンドルサイズ → AskAiPanel を dynamic import 検討

### UX
- [x] 操作不能状態 → ストリーム中もクリア可能
- [x] ローディングフィードバック → ストリーミング中のタイピングインジケーター
- [x] 質問例 → 初回表示時にサジェスト
