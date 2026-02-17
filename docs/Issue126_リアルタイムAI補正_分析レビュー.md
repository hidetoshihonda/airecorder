# Issue #126: リアルタイムAI補正 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 現在の文字起こし補正は録音保存後のバッチ処理（Issue #70）のみ。録音中にリアルタイムで補正できれば、ユーザーは録音中から高精度テキストを確認でき、会議中のメモ確認・共有の品質が向上する。
- **影響範囲**: 全ユーザーの録音中体験に影響。特に専門用語が多い会議（技術・医療・法務等）で Speech SDK の誤認識が多く、即時補正のニーズが高い。
- **緊急度**: **P3（Enhancement）** — 既存の保存後補正（Issue #70）とフレーズリスト（Issue #34）で基本カバーできており、UX改善の追加施策。

---

## 2. アーキテクチャ概観

### 2.1 現在のデータフロー（録音〜補正）

```
[マイク] ──→ [Speech SDK (SpeechRecognizer/ConversationTranscriber)]
                │
                ├── recognizing → interimTranscript（中間結果、画面表示用）
                │
                └── recognized → segments[] に追加（確定結果）
                          │
                          ├── [リアルタイム翻訳] → translateSegment()
                          │
                          ├── [AI Cues] → useAICues (5セグごとバッチ)
                          │
                          └── [録音停止] → handleSaveWithTitle()
                                    │
                                    └── API: POST /api/recordings
                                              │
                                              └── recordingService.createRecording()
                                                        │
                                                        └── processTranscriptCorrection()（非同期バッチ補正）
                                                                  │
                                                                  └── correctTranscript() → Azure OpenAI
                                                                            │
                                                                            └── correctedTranscript を CosmosDB に保存
```

### 2.2 コンポーネント依存関係

```
web/src/app/page.tsx (HomePage)
├── useRecordingStateMachine()    ... FSM 制御
├── useSpeechRecognition()        ... Speech SDK (API mode)
│     ├── segments: LiveSegment[]
│     └── interimTranscript: string
├── useTranslationRecognizer()    ... Speech SDK (SDK mode)
│     ├── segments: LiveSegment[]
│     └── translatedSegments: TranslatedSegment[]
├── useTranslation()              ... Translator REST API (API mode)
├── useAICues()                   ... リアルタイム文脈補助 (5セグバッチ)
├── useAudioRecorder()            ... 音声ファイル録音
├── useSpeakerManager()           ... 話者ラベル管理
└── handleSaveWithTitle()         ... 保存 → API → LLM バッチ補正

api/src/services/
├── transcriptCorrectionService.ts
│     ├── correctTranscript()           ... LLM 補正メイン
│     └── processTranscriptCorrection() ... 録音保存時に非同期実行
└── recordingService.ts
      └── createRecording() → processTranscriptCorrection() を fire-and-forget
```

### 2.3 状態管理の構造

| 状態 | 管理元 | 用途 |
|------|--------|------|
| `segments: LiveSegment[]` | `useSpeechRecognition` / `useTranslationRecognizer` | 確定済みセグメント |
| `interimTranscript: string` | 同上 | 認識中テキスト |
| `isRecording / isPaused` | `useRecordingStateMachine` (FSM) | 録音状態 |
| `correctionStatus` | CosmosDB (`Recording` model) | 保存後補正のステータス |
| `correctedTranscript` | CosmosDB | 補正後テキスト（保存後のみ） |

---

## 3. 設計上の分析 🟡

### DESIGN-1: 既存パターンとの類似性（AI Cues パターン）

**場所**: [web/src/hooks/useAICues.ts](web/src/hooks/useAICues.ts)

`useAICues` は「Nセグメントごとにバッチ + デバウンス + セッション上限」パターンで録音中にリアルタイム API 呼び出しを行っている。このパターンはリアルタイム補正にも転用可能。

| 設定 | AI Cues (現行) | リアルタイム補正（提案値） |
|------|---------------|------------------------|
| BATCH_SIZE | 5 セグメント | 3〜5 セグメント |
| DEBOUNCE_MS | 5,000ms | 3,000〜5,000ms |
| MAX_CALLS_PER_SESSION | 20 | 30〜50 |
| CONTEXT_WINDOW | 20 セグメント | 10〜20 セグメント |
| API endpoint | `POST /api/cues/generate` | `POST /api/correction/realtime`（新規） |

**✅ Good**: AI Cues のバッチ + デバウンスパターンは実績があり、そのままリアルタイム補正にも適用できる。

### DESIGN-2: 3つのアプローチ比較

Issue で提案された3アプローチを詳細に比較分析する。

#### アプローチA: セグメント確定時に逐次補正

```
recognized → 即座にLLM API呼び出し → 補正結果を segments[] に反映
```

| 項目 | 評価 |
|------|------|
| レイテンシ | 1〜3秒/セグメント |
| 精度 | 低（1セグメントだけでは文脈不足） |
| コスト | **極めて高い** — 1時間会議で約200〜300セグメント = 200〜300 API呼び出し |
| 実装複雑度 | 低 |
| UX | 1セグメントずつ更新がチラつく |

**💰 コスト試算**:
- gpt-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens
- 1セグメント ≈ 50 tokens (system prompt 200 + segment 50) = 250 tokens input
- 300回 × 250 tokens = 75,000 input tokens = **$0.01/会議**
- 実は API 呼び出し回数が多いだけでコスト自体は低いが、**レートリミットの問題**が発生

**❌ 却下理由**: 文脈不足で補正精度が低く、API レートリミットに到達するリスク

#### アプローチB: バッチ補正（N セグメントごと）— **推奨**

```
5セグメントたまる → デバウンス(3秒) → LLM API → 補正結果で segments[] を更新
```

| 項目 | 評価 |
|------|------|
| レイテンシ | 5〜10秒（バッチ蓄積 + API応答） |
| 精度 | **高い**（複数セグメントの文脈で補正可能） |
| コスト | 低〜中 — 1時間で 40〜60 回呼び出し |
| 実装複雑度 | 中（AI Cues パターン転用で軽減） |
| UX | バッチ単位でまとめて更新、自然な体験 |

**💰 コスト試算**:
- 50回 × 1,000 tokens (5セグメント + system prompt) = 50,000 input tokens = **$0.0075/会議**
- 出力: 50回 × 200 tokens = 10,000 output tokens = **$0.006/会議**
- **合計: 約 $0.014/会議**（極めて低コスト）

**✅ 推奨理由**: AI Cues で実績のあるパターンを転用でき、精度・コスト・UXのバランスが最も良い

#### アプローチC: クライアントサイド軽量補正

```
recognized → 正規表現/ルールベースで即座に補正
```

| 項目 | 評価 |
|------|------|
| レイテンシ | 0ms（即座） |
| 精度 | **極めて限定的** — 同音異義語の補正は不可能 |
| コスト | ゼロ |
| 実装複雑度 | 低 |
| UX | 変化に気づかないレベル |

**判定**: フレーズリスト（Issue #34）の PhraseListGrammar が既にこの役割を果たしている。追加実装は費用対効果が低い。

### DESIGN-3: 補正結果のUI統合設計

**問題**: 補正結果を segments[] にどう反映するか。

**選択肢**:

1. **In-place 更新** — `segments[i].text` を補正後テキストで直接上書き
   - 👍 シンプル、UIに追加変更不要
   - 👎 元テキストが消える、差分がわからない

2. **補正フィールド追加** — `LiveSegment` に `correctedText?: string` を追加
   - 👍 元テキスト保持、ユーザーが選択可能
   - 👎 UI変更が必要、表示ロジック複雑化

3. **並行表示（タブ/トグル）** — 「原文」「AI補正版」をタブ切り替え
   - 👍 リアルタイム文字起こしの信頼性を損なわない
   - 👎 実装コスト高、画面が複雑

**推奨: 選択肢 2（補正フィールド追加）**

理由: 既に `correctedTranscript` の保存後パターンが存在し、リアルタイムでもセグメント単位で `correctedText` を持つのが自然。UIでは補正があるセグメントに小さなバッジ（✨）を表示し、タップで原文/補正版を切り替えられるようにする。

### DESIGN-4: 保存後補正との統合

**問題**: リアルタイム補正済みのテキストを保存する際、保存後のバッチ補正（Issue #70）も走る。二重補正の問題。

**対策**:
- リアルタイム補正済みセグメントは `correctedText` フィールドに保持
- 保存時に `correctedText` が存在するセグメントは、それを使って `fullText` を再構成
- 保存後バッチ補正は `correctedText` 付きの高品質テキストに対して実行 → より精度の高い最終補正
- または、リアルタイム補正が有効だった場合は `correctionStatus: "realtime-completed"` として保存後補正をスキップ

---

## 4. 依存関係マトリクス 📊

### 4.1 Issue 間依存関係

```
Issue #126 (リアルタイムAI補正)
  ├── Issue #70 (保存後LLM補正) [CLOSED ✅] ─── 既存パターンを参考、二重補正問題
  ├── Issue #34 (フレーズリスト) [CLOSED ✅] ─── 精度向上の相補的手段
  ├── Issue #89 (AI Cues) [CLOSED ✅] ─── バッチ+デバウンスパターン転用
  └── Issue #35 (TranslationRecognizer) [CLOSED ✅] ─── SDK/APIモード分岐に影響
```

- **ブロッカー**: なし（全依存Issue実装済み）
- **並行作業可能**: 他の全P2/P3 Issue と並行可能

### 4.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| 新規 `useRealtimeCorrection` フック | Azure OpenAI API (gpt-4o-mini) | レートリミット、レイテンシ | BATCH_SIZE + DEBOUNCE_MS + MAX_CALLS |
| 新規 API `POST /api/correction/realtime` | Azure OpenAI | API Key 露出 | サーバーサイドAPI経由（既存パターン） |
| `LiveSegment` 型拡張 | `web/src/types/index.ts` | 後方互換性 | optional フィールド追加のみ |
| segments[] 更新 | React state 管理 | 不要な re-render | useRef + batch setState |

### 4.3 他 Issue/機能との相互作用

| 機能 | 影響 | 対策 |
|------|------|------|
| AI Cues (#89) | 同時に API 呼び出し → レートリミット圧迫 | 片方のみ有効 or 呼び出し間隔調整 |
| リアルタイム翻訳 (#33/#35) | 原文補正後に翻訳やり直し？ | 補正テキストで翻訳を再実行 or 翻訳は原文ベースのまま |
| 議事録生成 | 補正済みテキストで品質向上 | 保存時に `correctedText` を `fullText` に統合 |
| フレーズリスト (#34) | PhraseListGrammar がSDK側で精度向上 → LLM補正の負荷軽減 | 相補的、コンフリクトなし |

---

## 5. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome/Edge | ✅ 問題なし | — |
| Firefox | ✅ 問題なし | — |
| Safari/iOS | ⚠️ バックグラウンドでの API 呼び出し制限 | iOS でアプリがバックグラウンドに行くとfetch が中断される可能性 → AbortController で対応 |
| モバイル全般 | ⚠️ ネットワーク品質 | 3G/4G でレイテンシ増大 → バッチサイズ増やす or 無効化 |

---

## 6. 修正提案（優先順位付き）

### Phase 1: コアインフラ（P1）

#### Step 1: API エンドポイント作成

**新規ファイル**: `api/src/functions/realtimeCorrection.ts`

```typescript
// POST /api/correction/realtime
// Input: { segments: string[], language: string, phraseList?: string[] }
// Output: { corrections: Array<{ index: number, original: string, corrected: string }> }
```

**プロンプト設計**（既存 `CORRECTION_PROMPT` をリアルタイム向けに最適化）:

```typescript
const REALTIME_CORRECTION_PROMPT = `あなたは音声認識結果をリアルタイムで校正する専門家です。
与えられた複数の発言セグメントを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」）
- 明らかな聞き間違い
- 不自然な単語の区切り

【修正してはいけないもの】
- 話者の意図や内容
- 文体や口調
- 修正不要なセグメント

JSON形式で出力:
{
  "corrections": [
    { "index": 0, "original": "原文", "corrected": "補正文" },
    ...修正があるセグメントのみ
  ]
}

修正がない場合は空配列を返してください。`;
```

- `temperature: 0.2`（補正なので低めに）
- `max_tokens: 2000`
- `response_format: { type: "json_object" }`
- デプロイメント: `gpt-4o-mini`（低コスト・低レイテンシ）

#### Step 2: フロントエンド API サービス

**新規ファイル**: `web/src/services/correctionApi.ts`

```typescript
export interface RealtimeCorrectionInput {
  segments: string[];
  language: string;
  phraseList?: string[];
}

export interface CorrectionResult {
  index: number;
  original: string;
  corrected: string;
}
```

#### Step 3: `LiveSegment` 型拡張

**変更ファイル**: `web/src/types/index.ts`

```typescript
export interface LiveSegment {
  id: string;
  text: string;
  speaker?: string;
  speakerLabel?: string;
  timestamp: number;
  duration?: number;
  // ★ 新規: リアルタイム補正
  correctedText?: string;   // LLM による補正テキスト
  isCorrected?: boolean;    // 補正済みフラグ
}
```

### Phase 2: フック実装（P1）

#### Step 4: `useRealtimeCorrection` フック

**新規ファイル**: `web/src/hooks/useRealtimeCorrection.ts`

AI Cues (`useAICues.ts`) のパターンを転用:

```typescript
const BATCH_SIZE = 5;        // 5セグメントごとにAPI呼び出し
const DEBOUNCE_MS = 3000;    // 3秒デバウンス
const MAX_CALLS = 50;        // 1セッション50回上限
const CONTEXT_WINDOW = 10;   // 直近10セグメントのみ送信

interface UseRealtimeCorrectionOptions {
  segments: LiveSegment[];
  language: string;
  enabled: boolean;
  isRecording: boolean;
  phraseList?: string[];
  onCorrection: (corrections: Array<{ segmentId: string; correctedText: string }>) => void;
}
```

**ポイント**:
- `onCorrection` コールバックで親コンポーネント（page.tsx）の segments state を更新
- AbortController で録音停止時にリクエストキャンセル
- `callCount` を返して UI に表示（AI Cues と同様）

#### Step 5: page.tsx への統合

**変更ファイル**: `web/src/app/page.tsx`

```typescript
// useRealtimeCorrection フック統合
const { correctionCount, isCorrecting } = useRealtimeCorrection({
  segments,
  language: sourceLanguage,
  enabled: settings.enableRealtimeCorrection ?? false,
  isRecording: showRecordingUI,
  phraseList: settings.phraseList ?? [],
  onCorrection: (corrections) => {
    // segments state を更新
    setSegments(prev => prev.map(seg => {
      const correction = corrections.find(c => c.segmentId === seg.id);
      return correction
        ? { ...seg, correctedText: correction.correctedText, isCorrected: true }
        : seg;
    }));
  },
});
```

**問題**: `useSpeechRecognition` 内部で `segments` state が管理されており、外部から直接更新できない。

**解決策**: `useSpeechRecognition` に `updateSegment(id, patch)` メソッドを追加するか、segments をリフトアップして page.tsx で管理する。

→ **推奨: `updateSegment` メソッド追加**（既存アーキテクチャへの影響が最小）

```typescript
// useSpeechRecognition に追加
const updateSegment = useCallback((segmentId: string, patch: Partial<LiveSegment>) => {
  setSegments(prev => prev.map(seg =>
    seg.id === segmentId ? { ...seg, ...patch } : seg
  ));
}, []);
```

### Phase 3: UI/UX（P2）

#### Step 6: 設定画面に ON/OFF トグル追加

```typescript
// UserSettings に追加
enableRealtimeCorrection?: boolean;
```

#### Step 7: 補正済みセグメントの視覚的表現

- 補正済みセグメントに `✨` バッジ
- タップで原文表示（tooltip or expand）
- 補正中インジケーター（小さなスピナー）

### Phase 4: 堅牢性強化（P2）

#### Step 8: エラー時フォールバック

- API 呼び出し失敗 → 原文のまま表示（silent failure）
- ネットワーク切断 → 自動的に無効化、再接続時に再開
- レートリミット → バッチサイズ倍増 + デバウンス延長

#### Step 9: 保存後補正との統合

- `correctedText` 付きセグメントは保存時に統合
- `correctionStatus: "realtime-completed"` でバッチ補正スキップ or 最終パス補正

---

## 7. テスト戦略

### 7.1 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|-------------|---------|
| 5セグメント蓄積 → API呼び出し | 補正リクエスト送信 |
| 3セグメントで録音停止 | 未バッチのセグメントは未補正のまま |
| API エラー → 次バッチ | エラーカウント増加、原文保持 |
| MAX_CALLS到達 | 以降の呼び出しスキップ |
| 連打で segments 高速追加 | デバウンスで API 呼び出し頻度制限 |

### 7.2 統合テスト

| シナリオ | 確認項目 |
|---------|---------|
| 録音中の補正表示 | UI にリアルタイム反映 |
| 補正 → 保存 → 再読み込み | correctedText が保持 |
| AI Cues + リアルタイム補正 同時ON | レートリミット超過しない |
| 録音一時停止 → 再開 | 補正がリセットされない |

### 7.3 手動テスト

| テスト | Chrome | Safari | Firefox | iOS |
|--------|--------|--------|---------|-----|
| 基本補正フロー | — | — | — | — |
| ネットワーク切断テスト | — | — | — | — |
| 長時間録音(1h) | — | — | — | — |

---

## 8. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API エンドポイント `POST /api/correction/realtime` | 2h | `api/src/functions/` |
| 2 | フロントエンド API サービス `correctionApi.ts` | 1h | `web/src/services/` |
| 3 | `LiveSegment` 型拡張 (`correctedText`, `isCorrected`) | 0.5h | `web/src/types/index.ts` |
| 4 | `useSpeechRecognition` に `updateSegment` メソッド追加 | 1h | `web/src/hooks/useSpeechRecognition.ts` |
| 5 | `useTranslationRecognizer` に同様のメソッド追加 | 1h | `web/src/hooks/useTranslationRecognizer.ts` |
| 6 | `useRealtimeCorrection` フック新規作成 | 3h | `web/src/hooks/` |
| 7 | `page.tsx` 統合（フック呼び出し、onCorrection） | 2h | `web/src/app/page.tsx` |
| 8 | 設定項目追加 (`enableRealtimeCorrection`) | 1h | 型定義 + 設定画面 |
| 9 | UI 表示（補正バッジ、原文表示） | 2h | UI コンポーネント |
| 10 | 保存時統合（correctedText → fullText 統合） | 1.5h | `page.tsx` + `recordingService.ts` |
| 11 | テスト・検証 | 2h | — |
| **合計** | | **17h** | |

---

## 9. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Azure OpenAI レートリミット超過 | 中 | 高 | BATCH_SIZE + MAX_CALLS + AI Cues との排他制御 |
| 補正レイテンシが UX を損なう | 低 | 中 | デバウンスで自然な更新タイミングに |
| LLM が過剰補正（意味を変える） | 中 | 高 | `temperature: 0.2` + 「修正不要なら空配列」指示 |
| 二重補正問題（リアルタイム + 保存後） | 中 | 中 | correctionStatus フラグで制御 |
| セグメント更新時の stale closure | 中 | 中 | useRef パターン（AI Cues と同様） |
| API コスト増 | 低 | 低 | gpt-4o-mini で $0.014/会議、ほぼ無視できるレベル |
| React re-render パフォーマンス | 低 | 中 | batch setState + useMemo |

---

## 10. 結論

### 最大のポイント
- **アプローチB（バッチ補正）が最適解** — AI Cues の実績あるパターンを転用でき、コスト $0.014/会議と極めて低い
- 既存の保存後補正（Issue #70）、フレーズリスト（Issue #34）、AI Cues（Issue #89）全て実装済みで、技術的ブロッカーなし
- 最大のリスクは「LLM 過剰補正」と「二重補正問題」だが、プロンプト設計と status フラグで対応可能

### 推奨する修正順序
1. API エンドポイント + フロントエンド API サービス（Step 1-2）
2. 型拡張 + フック作成（Step 3-6）
3. page.tsx 統合（Step 7）
4. 設定 + UI（Step 8-9）
5. 保存時統合 + テスト（Step 10-11）

### 他 Issue への影響
- Issue #147（話者ラベル編集）: `LiveSegment` 型拡張が重なる可能性 → `correctedText` は独立フィールドなのでコンフリクト低
- Issue #97（ノイズ除去）: 音声品質向上 → Speech SDK の認識精度向上 → リアルタイム補正の負荷軽減

### 判定: **CONDITIONAL GO** ✅

条件:
1. `enableRealtimeCorrection` はデフォルト OFF（ユーザー opt-in）
2. AI Cues と同時使用時のレートリミット対策を事前検証
3. MVP ではアプローチB（バッチ補正）のみ実装し、アプローチA/Cは将来検討

---

*分析日: 2026-02-17*
*分析者: ReviewAAgent*
