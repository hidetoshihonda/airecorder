# Issue #89: AI Cues 録音中のリアルタイム文脈補助 — 分析レビュー

> **Issue**: [#89](https://github.com/hidetoshihonda/airecorder/issues/89)
> **Priority**: P3 (enhancement)
> **工数見積**: L（1-2週間）
> **レビュー日**: 2026-02-15
> **ステータス**: Open

---

## 1. エグゼクティブサマリー

- **問題の本質**: 録音中にAIがリアルタイムで会話の文脈を解析し、専門用語の解説・人物情報・回答提案をサイドパネルに自動表示する**完全新規機能**。競合10製品すべてに非搭載の最大の戦略的差別化ポイント。
- **影響範囲**: フロントエンド（録音画面UI・レイアウト変更）、バックエンド（新規API追加）、設定（ON/OFFトグル）、i18n（3言語追加）、コスト（Azure OpenAI呼び出し増加）に広範に影響。全ユーザーの録音体験に直結する。
- **緊急度**: **Low**（P3 / Phase 3 次世代AI差別化）。既存機能に障害はなく、戦略的な機能追加。ただし差別化インパクトは最大。

---

## 2. アーキテクチャ概観

### 2.1 対象機能のコンポーネント依存関係図

```
┌────────────────────────────────────────────────────────────────────────┐
│  web/src/app/page.tsx (HomePage)  ←── 録音画面メインコンポーネント       │
│  ├─ useRecordingStateMachine  ←── FSM: 録音状態管理                    │
│  ├─ useSpeechRecognition      ←── API mode: 確定セグメント供給         │
│  ├─ useTranslationRecognizer  ←── SDK mode: 確定セグメント供給         │
│  ├─ useAudioRecorder          ←── 音声キャプチャ                       │
│  ├─ useTranslation            ←── 差分翻訳                            │
│  │                                                                     │
│  ├─ 【NEW】useAICues          ←── AI Cues フック（セグメント→OpenAI）  │
│  │    ├─ バッチ収集（N確定セグメント）                                  │
│  │    ├─ デバウンス（過剰API呼び出し防止）                              │
│  │    ├─ API呼び出し（/api/cues/generate）                             │
│  │    └─ SSEストリーミング受信 → Cueカード生成                         │
│  │                                                                     │
│  └─ 【NEW】AICuesPanel        ←── サイドパネルUIコンポーネント          │
│       ├─ CueCard (concept | bio | suggestion)                          │
│       └─ 時系列スクロール                                              │
└────────────────────────────────────────────────────────────────────────┘
                    │ REST (POST /api/cues/generate) + SSE
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  api/src/functions/cues.ts  ←── 【NEW】Azure Functions エンドポイント  │
│  ├─ セグメントバッチ受信                                               │
│  ├─ Azure OpenAI (GPT-4) 呼び出し                                     │
│  │    ├─ システムプロンプト: 文脈解析指示                               │
│  │    └─ response_format: json_object + stream: true                   │
│  └─ SSE形式でフロントエンドにストリーミング返却                         │
└────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
            ┌──────────────┐
            │ Azure OpenAI │
            │ (GPT-4)      │
            └──────────────┘
```

### 2.2 データフロー図

```
[マイク] → [Speech SDK] → [確定セグメント (segments[])]
                                    │
                                    ├──→ [TranscriptView] (既存: 文字起こし表示)
                                    │
                                    └──→ 【NEW】[useAICues]
                                              │
                                              ├─ バッチ収集 (5セグメントごと等)
                                              ├─ デバウンス (3〜5秒)
                                              │
                                              ▼
                                         POST /api/cues/generate
                                         { segments[], context, language }
                                              │
                                              ▼
                                         Azure OpenAI (stream)
                                              │
                                              ▼
                                         SSE → フロントエンド
                                              │
                                              ▼
                                    【NEW】[AICuesPanel]
                                         ├─ 💡 Concept カード
                                         ├─ 👤 Bio カード
                                         └─ 💬 Suggestion カード
```

### 2.3 状態管理の構造

| 状態 | 管理場所 | 説明 |
|------|---------|------|
| `recordingState` | `useRecordingStateMachine` | FSM: idle/recording/paused/stopped |
| `segments[]` | `useSpeechRecognition` / `useTranslationRecognizer` | 確定済み文字起こしセグメント |
| **`aiCues[]`** | **`useAICues` (NEW)** | AI Cue カードの配列 |
| **`isCuesEnabled`** | **`UserSettings` (NEW)** | AI Cues ON/OFF |
| **`isCuesLoading`** | **`useAICues` (NEW)** | OpenAI応答待ち状態 |
| **`cuesError`** | **`useAICues` (NEW)** | エラー状態 |
| **`lastProcessedIndex`** | **`useAICues` (NEW)** | 最後に処理したセグメントのインデックス |

---

## 3. 重大バグ分析 🔴

> **注**: Issue #89 は新規機能であり、既存コードにバグはありません。ここでは**実装時に発生しうる重大な設計リスク**を事前に分析します。

### BUG-RISK-1: OpenAI API コスト爆発 [Critical]

**場所**: `useAICues` (新規フック) — セグメント監視ロジック
**問題**: 録音中のセグメントは数秒間隔で生成される。デバウンスやバッチサイズの設計を誤ると、30分の会議で数十〜数百回のOpenAI呼び出しが発生し、コストが急増する。
**影響**: 月額コストが$35→$100+に跳ね上がる可能性。GPT-4のトークン単価は入力$0.03/1K, 出力$0.06/1K。
**根本原因**: リアルタイム性とコストのトレードオフが未定義。
**修正方針**:
- **バッチサイズ**: 最低5確定セグメント（約30秒〜1分の会話）でバッチ化
- **デバウンス**: 最低5秒のクールダウン
- **1セッション上限**: 最大20回（100セグメント/20回 = 5セグメント/回）
- **コンテキストウィンドウ制限**: 直近20セグメント（約2分）のみ送信
- **Issue #84 (API使用量表示) との連携**: Cues呼び出し回数の可視化

### BUG-RISK-2: SSE接続のリソースリーク [High]

**場所**: `useAICues` (新規フック) — SSE接続管理
**問題**: SSEストリーミングにEventSourceまたはfetchのReadableStreamを使用する場合、録音停止時・ページ離脱時・pause時にストリーム接続が適切にクローズされないとメモリリークが発生する。
**影響**: 長時間録音でブラウザメモリが増大し、最終的にタブがクラッシュ。
**修正方針**:
```typescript
// useEffect cleanup で必ず abort
useEffect(() => {
  const controller = new AbortController();
  // ... fetch with signal: controller.signal
  return () => controller.abort();
}, []);
```

### BUG-RISK-3: 録音中のレイアウトシフト [High]

**場所**: `web/src/app/page.tsx` L708 — `max-w-5xl` コンテナ
**コード**:
```tsx
<div className="mx-auto flex h-[calc(100dvh-56px)] max-w-5xl flex-col px-4 py-2 sm:px-6 lg:px-8">
```
**問題**: 現在の録音画面は `max-w-5xl` (1024px) の単一カラムレイアウト。AI Cuesサイドパネルを追加するとレイアウトが大幅に変わり、既存のタブ（文字起こし・翻訳・議事録）の表示領域が圧迫される。
**影響**: 全ユーザーの録音体験UIが変化。モバイルでは特に深刻。
**修正方針**:
- **デスクトップ (lg以上)**: 2カラムレイアウト（左: 既存タブ / 右: AI Cuesパネル）
- **モバイル/タブレット**: AI Cuesパネルはボトムシートまたは折りたたみ可能パネル
- `max-w-5xl` → `max-w-7xl` に拡張（AI Cues有効時のみ）
- 遷移アニメーションでCLS (Cumulative Layout Shift) を最小化

### BUG-RISK-4: Stale Closure による古いセグメント参照 [Medium]

**場所**: `useAICues` (新規フック) — useEffect内でのsegments参照
**問題**: デバウンスタイマー内で`segments`を参照すると、タイマー発火時の値ではなくクロージャ取得時の古い値を使う可能性がある。既存の`useTranslation`フック（page.tsx L282-300）でも`prevSegmentCountRef`パターンで同種の問題に対処している。
**修正方針**:
```typescript
const segmentsRef = useRef(segments);
segmentsRef.current = segments;

// デバウンスコールバック内ではref経由でアクセス
const currentSegments = segmentsRef.current;
```

### BUG-RISK-5: 翻訳との API 競合 [Medium]

**場所**: `page.tsx` L282-313 (差分翻訳useEffect) と 新規`useAICues`
**問題**: 録音中に差分翻訳とAI Cuesの両方がAPIを叩くため、ネットワーク帯域とAPI rate limitの競合が発生する可能性。特にSDKモード（TranslationRecognizer）では翻訳はSDK内部処理だが、APIモードでは翻訳REST API + AI Cues OpenAI APIが同時に走る。
**修正方針**:
- AI Cues APIリクエストに`priority: "low"`を設定し、翻訳を優先
- `navigator.connection` APIでネットワーク品質を確認し、低帯域時はCuesをスロットリング
- AbortControllerで前回のCuesリクエストをキャンセル可能に

---

## 4. 設計上の問題 🟡

### DESIGN-1: page.tsx の肥大化 [High]

**現状**: `page.tsx` は既に1,572行。AI Cuesフックのオーケストレーション、状態統合、UIレンダリングを追加すると2,000行を超える見込み。
**改善方針**: AI Cuesは独立性が高いため、`AICuesPanel`コンポーネントと`useAICues`フックに完全分離すべき。`page.tsx`には`<AICuesPanel segments={segments} enabled={settings.enableAICues} />`の1行だけを追加する設計にする。

### DESIGN-2: サイドパネルのレスポンシブ設計 [High]

**現状**: 録音画面は `max-w-5xl` の単一カラム。Tabs(3つ)が画面幅いっぱいを使う前提のUI。
**問題**: サイドパネル追加時に2カラムに変更すると、タブの内容表示領域が狭くなる。特にTranscriptViewの話者バブル表示やSummaryのテーブル表示に影響。
**改善方針**:
- デスクトップ: サイドパネルは固定幅320px、メインコンテンツは残り幅
- パネルの開閉トグルボタンで任意に折りたたみ可能
- モバイル: サイドパネルは非表示、代わりにフローティングバッジで通知→タップで展開

### DESIGN-3: Cue カードの型定義 [Medium]

**問題**: AI Cuesには3種類のカード（Concept/Bio/Suggestion）があり、それぞれ構造が異なる。型安全に管理しないとUIレンダリングでランタイムエラーが発生する。
**改善方針**:
```typescript
type CueType = "concept" | "bio" | "suggestion";

interface BaseCue {
  id: string;
  type: CueType;
  timestamp: number;     // セグメントのタイムスタンプ
  segmentIndex: number;  // 対応するセグメントのインデックス
}

interface ConceptCue extends BaseCue {
  type: "concept";
  term: string;          // 専門用語・略語
  definition: string;    // 解説
  context?: string;      // 使用文脈
}

interface BioCue extends BaseCue {
  type: "bio";
  name: string;          // 人物・組織名
  description: string;   // プロフィール情報
  role?: string;         // 役職・関係性
}

interface SuggestionCue extends BaseCue {
  type: "suggestion";
  question: string;      // 相手の質問/論点
  suggestion: string;    // 回答案/提案
  reasoning?: string;    // 提案の根拠
}

type AICue = ConceptCue | BioCue | SuggestionCue;
```

### DESIGN-4: SSE vs WebSocket vs Polling の選択 [Medium]

**Issue記載**: SSE（Server-Sent Events）
**分析**: Azure Functions Consumption PlanではWebSocket非サポート。SSEは単方向ストリーミングに最適だが、Azure Functions + SWA経由でSSEが安定動作するか検証が必要。
**代替案**:
1. **SSE (推奨)**: Azure Functions v4はSSE対応。`Transfer-Encoding: chunked`でストリーミング可能。ただしSWA Proxyのタイムアウト（240秒）に注意。
2. **通常のJSON POST**: SSEを使わず、OpenAIのレスポンス全体を待ってJSON返却。レイテンシは増えるが実装がシンプル。最初のMVPはこれで十分。
3. **Polling**: フロントエンドから定期的にステータスをポーリング。最もロバストだが遅延が大きい。

**推奨**: Phase 1は**通常のJSON POST**でMVP実装。Phase 2でSSEストリーミングに昇格。

### DESIGN-5: 既存エラーハンドリングへの統合 [Low]

**現状**: `page.tsx` L231でエラー配列を統合管理。
```tsx
const errors = [speechError, translationError, ttsError, audioError, fsmError].filter(Boolean) as string[];
```
**改善方針**: `cuesError`をこの配列に追加。ただしAI CuesのエラーはCriticalではないので、メインエラーバーではなくAI Cuesパネル内に表示すべき。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #89 (AI Cues)
  ├──→ Issue #84 (API使用量表示) [推奨: Cues呼び出し回数の可視化]
  │     └─ 並行作業可能だが、API使用量トラッキングの共通基盤があると便利
  │
  ├──→ Issue #97 (ノイズキャンセリング) [間接的: 音声品質→セグメント品質→Cues品質]
  │     └─ ブロッカーではない
  │
  ├──→ Issue #85 (Ask AI: 録音内容への対話型AI質問応答) [類似機能]
  │     └─ AI Cuesは「プッシュ型」、Ask AIは「プル型」。共通のOpenAI呼び出し基盤を共有可能
  │
  └──→ Issue #94 (AIサマリーテンプレートの大量展開) [間接的: OpenAIプロンプト設計の共通基盤]
        └─ ブロッカーではない
```

- **ブロッカー**: なし。完全に独立して実装可能。
- **並行作業可能**: Issue #84, #85, #94

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `useAICues` | `segments[]` (useSpeechRecognition / useTranslationRecognizer) | Low | 両モードでsegments統一済み (page.tsx L176) |
| `cues.ts` (API) | Azure OpenAI SDK (`openai` パッケージ) | Low | api/package.json に既存 (^4.77.0) |
| `AICuesPanel` | page.tsx レイアウト構造 | **High** | max-w-5xl→max-w-7xlの変更が必要 |
| `UserSettings` | AuthContext / settingsApi | Low | 既存パターン踏襲 |
| SSE通信 | Azure Functions + SWA Proxy | **Medium** | SWAのタイムアウト制限。MVP段階ではJSON POSTで回避 |

### 5.3 他 Issue/機能との相互作用

| Issue/機能 | 相互作用 | 対策 |
|-----------|---------|------|
| Issue #33 (差分翻訳) | 同じ `segments[]` をデータソースとして共有 | 読み取り専用なので競合なし |
| Issue #35 (SDK翻訳) | SDK/APIモード切替時にAI Cuesのセグメントソースも切替 | `segments` は page.tsx L176 で統一済み |
| Issue #85 (Ask AI) | OpenAI呼び出し基盤を共有可能 | 共通の `openaiService` 抽出を推奨 |
| Issue #84 (API使用量) | AI Cues のAPI呼び出しがコストに影響 | Cues呼び出し回数をトラッキングに含める |
| 録音状態 FSM | Cuesの開始/停止はFSM状態に連動 | `showRecordingUI` フラグを参照 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Desktop) | ✅ 完全対応 | SSE/fetch streaming 対応済み |
| Firefox (Desktop) | ✅ 完全対応 | SSE対応済み |
| Safari (Desktop) | ⚠️ 要検証 | fetch streaming の ReadableStream 対応は Safari 16.4+ |
| Chrome (Mobile) | ✅ 対応 | サイドパネルUIをレスポンシブ対応必要 |
| Safari (iOS) | ⚠️ 要検証 | バックグラウンド制限でSSE切断の可能性 |
| Azure Functions | ✅ Node.js 20 | SSE対応。ただしConsumption Planのコールドスタートに注意 |
| Azure SWA Proxy | ⚠️ 要検証 | SSEストリーミングのProxyタイムアウト (240秒) |

---

## 7. 修正提案（優先順位付き）

### Phase 1: MVP 実装（P0）— 中核機能

**目標**: 録音中のセグメントをバッチ送信し、OpenAIから文脈情報を取得してサイドパネルに表示

#### 7.1 バックエンド: `api/src/functions/cues.ts` (新規)

```typescript
// POST /api/cues/generate
// 入力: { segments: string[], language: string, context?: string }
// 出力: { cues: AICue[] }
// OpenAI GPT-4 に「直近のセグメントから専門用語/人物/提案を抽出」するプロンプトを送信
// Phase 1 では JSON 一括返却（SSE なし）
```

**必要ファイル**:
- `api/src/functions/cues.ts` (新規)
- `api/src/index.ts` (import追加)

#### 7.2 フロントエンド: `useAICues` フック (新規)

```typescript
// web/src/hooks/useAICues.ts (新規)
// - segments[] を監視し、N個の新規セグメントが溜まったらAPI呼び出し
// - デバウンス（5秒）
// - 1セッション上限（20回）
// - AbortController でキャンセル管理
// - 返却値: { cues, isLoading, error, clearCues }
```

#### 7.3 フロントエンド: `AICuesPanel` コンポーネント (新規)

```typescript
// web/src/components/AICuesPanel.tsx (新規)
// - CueCard: concept / bio / suggestion の3タイプ
// - 時系列スクロール（最新が下）
// - 折りたたみ可能
// - AI Cues OFF 時は非表示
```

#### 7.4 フロントエンド: レイアウト変更

```typescript
// web/src/app/page.tsx
// - max-w-5xl → max-w-7xl (AI Cues 有効時)
// - flex-row レイアウト (lg以上)
// - 左: 既存タブ / 右: AICuesPanel
```

#### 7.5 設定: `UserSettings` 拡張

```typescript
// web/src/types/index.ts — UserSettings に追加
enableAICues?: boolean;  // デフォルト: false
```

#### 7.6 i18n: メッセージファイル追加

- `web/messages/ja.json` — `AICues` セクション追加
- `web/messages/en.json` — 同上
- `web/messages/es.json` — 同上

**変更ファイル一覧 (Phase 1)**:

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `api/src/functions/cues.ts` | **新規** | OpenAI呼び出しAPI |
| `api/src/index.ts` | 修正 | import追加 |
| `web/src/hooks/useAICues.ts` | **新規** | AI Cuesフック |
| `web/src/components/AICuesPanel.tsx` | **新規** | サイドパネルUI |
| `web/src/app/page.tsx` | 修正 | レイアウト変更 + フック統合 |
| `web/src/types/index.ts` | 修正 | AICue型 + UserSettings拡張 |
| `web/src/contexts/AuthContext.tsx` | 修正 | defaultSettings追加 |
| `web/src/app/settings/page.tsx` | 修正 | AI Cues ON/OFFトグル追加 |
| `web/messages/ja.json` | 修正 | AICuesセクション追加 |
| `web/messages/en.json` | 修正 | 同上 |
| `web/messages/es.json` | 修正 | 同上 |

---

### Phase 2: ストリーミング強化（P1）

- SSE対応: OpenAI streaming → Azure Functions → フロントエンドへリアルタイム配信
- Cueカードの逐次表示（タイピングアニメーション）
- ネットワーク品質に応じたアダプティブバッチング

### Phase 3: 堅牢性・UX強化（P2）

- Cueの「ピン留め」「非表示」機能
- Cueの保存（録音データと一緒にCosmos DBに永続化）
- Cueの品質フィードバック（👍👎）→ プロンプト改善ループ
- モバイル対応（ボトムシートUI）
- コスト最適化: GPT-4 → GPT-4o-mini への切替検討

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 入力 | 期待出力 |
|------------|------|---------|
| セグメント0件 → Cues非発火 | `segments = []` | API呼び出しなし |
| セグメント4件 → バッチ未達 | `segments.length = 4` (閾値5) | API呼び出しなし |
| セグメント5件 → バッチ達成 | `segments.length = 5` | API呼び出し1回 |
| デバウンス内の連続セグメント | 1秒間隔で5セグメント | API呼び出し1回（5秒後） |
| 録音停止 → 接続クリーンアップ | `showRecordingUI = false` | AbortController.abort() |
| 上限到達（20回） | 21回目のバッチ | API呼び出しなし |
| AI Cues OFF | `settings.enableAICues = false` | フック全体が無効 |
| エラー時 | API 500 | `cuesError` にメッセージ、UIにエラー表示 |

### 8.2 統合テスト

- **API**: Jest + Azure OpenAI モック → `cues.ts` のプロンプト送信・レスポンスパース検証
- **フック**: React Testing Library + MSW → `useAICues` のバッチ処理・デバウンス検証
- **UI**: AICuesPanel に Cue 配列を渡し、3タイプ全てが正しくレンダリングされるか検証

### 8.3 手動テスト

| シナリオ | 検証ポイント |
|---------|------------|
| 5分間の録音 | Cuesが適切なタイミングで表示されるか |
| 専門用語を含む会話 | Concept カードが生成されるか |
| 人名を含む会話 | Bio カードが生成されるか |
| 質問形式の発言 | Suggestion カードが生成されるか |
| 録音→停止→再開 | Cues状態がリセット→再開されるか |
| モバイルブラウザ | レスポンシブUIが正常か |
| AI Cues OFF | パネルが非表示か |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | 型定義追加 (`AICue`, `UserSettings.enableAICues`) | 0.5h | types, AuthContext |
| 2 | バックエンドAPI (`cues.ts`) + プロンプト設計 | 4h | api/ |
| 3 | `useAICues` フック実装 (バッチ + デバウンス + AbortController) | 4h | hooks/ |
| 4 | `AICuesPanel` UIコンポーネント実装 | 4h | components/ |
| 5 | `page.tsx` レイアウト変更 (2カラム + 折りたたみ) | 3h | app/page.tsx |
| 6 | 設定画面にAI Cues ON/OFFトグル追加 | 1h | settings/page.tsx |
| 7 | i18n メッセージ追加 (3言語) | 1h | messages/ |
| 8 | 手動テスト + デバッグ | 3h | 全体 |
| 9 | PR作成 + CIパス確認 | 1h | CI/CD |
| **合計** | | **~21.5h (≒3日)** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| OpenAI APIコスト急増 | **高** | **高** | バッチサイズ・セッション上限・GPT-4o-miniへの切替 |
| SSEがSWA Proxy経由で不安定 | 中 | 中 | Phase 1はJSON POST、Phase 2でSSE検証 |
| レイアウト変更による既存UI崩れ | 中 | 高 | 折りたたみパネル設計で影響を最小化 |
| OpenAIレスポンスの品質不安定 | 中 | 中 | プロンプトエンジニアリング + JSON出力強制 |
| Consumption Planのコールドスタート | 低 | 中 | 初回Cue表示に数秒の遅延。ユーザーに「分析中...」を表示 |
| page.tsxのさらなる肥大化 | 高 | 中 | AICuesPanel完全分離設計で`page.tsx`への追加は最小限 |
| 録音中のネットワーク帯域圧迫 | 低 | 中 | 翻訳API優先、Cuesは低優先度 |

---

## 11. 結論

### 最大の問題点

1. **OpenAI APIコスト管理**が最大の技術課題。バッチサイズ・デバウンス・セッション上限の3重ガードで制御する必要がある。
2. **レイアウト変更**のインパクトが大きい。現在の単一カラム→2カラムへの変更は慎重に設計すべき。
3. **page.tsxの肥大化**を防ぐため、AI Cues関連ロジックは完全にコンポーネント分離する。

### 推奨する修正順序

1. 型定義 → 2. バックエンドAPI → 3. フック → 4. UIコンポーネント → 5. レイアウト変更 → 6. 設定 → 7. i18n → 8. テスト

### 他 Issue への影響サマリー

- **Issue #84 (API使用量)**: AI Cuesの呼び出し回数をトラッキングに含める必要あり
- **Issue #85 (Ask AI)**: OpenAI呼び出し基盤の共通化で相互に恩恵あり
- **既存機能**: segments[] の読み取りのみで、既存の文字起こし・翻訳機能への影響なし

### ✅ Good な既存設計

- ✅ **segments[] の統一**: API/SDKモード両方で `segments` が統一されている（page.tsx L176）。AI Cuesはこの統一データソースを直接利用可能。
- ✅ **FSMによる状態管理**: `showRecordingUI` フラグでCuesの開始/停止を明確に制御可能。
- ✅ **OpenAI SDK既存**: api/package.json に `openai` パッケージが既にインストール済み。
- ✅ **認証ルート**: SWA configで `/api/*` が認証必須。新規エンドポイントも自動的に保護される。
- ✅ **UserSettings パターン**: enableSpeakerDiarization と同じパターンで enableAICues を追加可能。

### 判定

## `GO` ✅

新規機能であり既存コードへのリスクは低い。Phase 1（JSON POST + 折りたたみパネル）で段階的に実装し、Phase 2でSSEストリーミングに昇格する戦略を推奨。コスト管理の設計（バッチ・上限・GPT-4o-mini検討）を最優先に。
