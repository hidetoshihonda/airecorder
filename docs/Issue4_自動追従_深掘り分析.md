# Issue #4: 文字起こし/翻訳が長くなると最新追従が実質不可能 — 深掘り分析レポート

**Issue**: [#4](https://github.com/hidetoshihonda/airecorder/issues/4) [P0] 文字起こし/翻訳が長くなると最新追従が実質不可能  
**分析日**: 2025-07-11  
**分析者**: ReviewAAgent  
**対象ブランチ**: `feature/fix-auto-scroll`  

---

## 1. エグゼクティブサマリー

- **問題の本質**: 録音ページの文字起こし/翻訳表示エリアに **スクロール制御が一切なく**、テキストが増えると表示が下方に伸び続け、ユーザーが最新テキストを追跡できなくなる。
- **影響範囲**: 5分以上の録音を行う **全ユーザーの100%** に影響。30分以上の会議録音では完全にUXが破綻する。
- **修正の緊急度**: **Critical (P0)** — コア機能のユーザビリティが実質的に使用不能。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
page.tsx (HomePage)
├── useRecordingStateMachine() → FSM 状態管理
├── useSpeechRecognition()     → transcript, interimTranscript 生成
│   └── Azure Speech SDK (continuous recognition)
├── useAudioRecorder()         → 音声録音 (MediaRecorder)
├── useTranslation()           → translatedText 生成
│   └── Azure Translator API (debounced 500ms)
├── useTextToSpeech()          → 読み上げ
└── UI Components
    ├── Recording Controls (Card)
    ├── Tabs (Radix UI)
    │   ├── TabsContent "transcript"  ← ★問題箇所
    │   ├── TabsContent "translation" ← ★問題箇所
    │   └── TabsContent "minutes"
    └── AuthGateModal
```

### 2.2 データフロー（文字起こし）

```
マイク入力
  ↓
Azure Speech SDK (recognizing event)
  ↓ setInterimTranscript(event.result.text)
  ↓
Azure Speech SDK (recognized event)
  ↓ setTranscript(prev => prev + " " + newText)
  ↓
page.tsx transcript state
  ↓ (直接 JSX で {transcript} をレンダリング)
  ↓
<div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4">
  {transcript}  ← ★ 無限に伸びる div、スクロール制御なし
</div>
```

### 2.3 状態管理の構造

| State 変数 | 管理場所 | 型 | 用途 |
|---|---|---|---|
| `transcript` | `useSpeechRecognition` | `string` | 確定テキスト全文（累積追記） |
| `interimTranscript` | `useSpeechRecognition` | `string` | 認識中の暫定テキスト |
| `translatedText` | `page.tsx` (useState) | `string` | 翻訳結果全文 |
| `showRecordingUI` | `page.tsx` (derived) | `boolean` | 録音UI表示フラグ |

**✅ Good**: FSM ベースの状態管理は Issue #2 の修正で堅牢に設計されている。

---

## 3. 重大バグ分析 🔴

### BUG-1: 文字起こし表示エリアにスクロール制御がない [Critical]

**場所**: `web/src/app/page.tsx` L637-641（録音中の transcript 表示）

**コード**:
```tsx
{transcript && (
  <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
    {transcript}
  </div>
)}
```

**問題**:
- `max-height` も `overflow-y` も設定されていない
- テキストが増えるたびに div が無限に伸長する
- ページ全体が縦に伸び、最新テキストを見るにはページスクロールが必要
- `scrollIntoView` / `scrollTo` 等の自動追従ロジックが存在しない

**影響**: 5分以上の録音で最新テキストがビューポート外に消える。ユーザーは手動でページ最下部までスクロールし続ける必要がある。

**根本原因**: 初期実装時に短時間録音のみを想定し、長時間録音時のスクロール設計を行わなかった。

**修正方針**:
1. 表示エリアに `max-h-[400px] overflow-y-auto` を設定
2. `useRef` でスクロールコンテナを参照
3. `transcript` 変更時に `scrollTop = scrollHeight` で自動追従
4. ユーザー手動スクロール検知時に自動追従を一時停止
5. 「最新に追従」トグルボタンを設置

---

### BUG-2: interimTranscript 表示エリアも同様にスクロール制御がない [Critical]

**場所**: `web/src/app/page.tsx` L642-646

**コード**:
```tsx
{interimTranscript && (
  <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-blue-600 italic">
    {interimTranscript}
  </div>
)}
```

**問題**: interimTranscript 自体は1文程度で短いが、transcript div の直後に配置されているため、transcript が長い場合に interimTranscript もビューポート外に隠れる。

**影響**: リアルタイムで認識中のテキストが見えなくなり、「動作しているのか不明」になる。

**修正方針**: transcript + interimTranscript を同一スクロールコンテナ内に配置し、interimTranscript が常にコンテナ最下部に表示されるようにする。

---

### BUG-3: 翻訳表示エリアにもスクロール制御がない [High]

**場所**: `web/src/app/page.tsx` L695-697（翻訳タブ内の翻訳テキスト表示）

**コード**:
```tsx
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {translatedText}
</div>
```

**問題**: 翻訳タブでも同様に `max-height` / `overflow-y` がなく、長い翻訳テキストで表示が破綻する。

**影響**: リアルタイム翻訳を有効にした長時間録音で、翻訳テキストも追跡不能になる。

**修正方針**: transcript タブと同様のスクロール制御 + 自動追従を翻訳タブにも適用する。

---

### BUG-4: 録音停止後の transcript 表示にもスクロール制御がない [Medium]

**場所**: `web/src/app/page.tsx` L653-655（録音停止後の表示）

**コード**:
```tsx
) : transcript ? (
  <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
    {transcript}
  </div>
)
```

**問題**: 録音停止後も全文が1つの div にレンダリングされ、長文の場合にページが非常に長くなる。

**影響**: 録音停止後のレビュー時にも長文で使いにくい。ただし自動追従は不要。

**修正方針**: `max-h-[600px] overflow-y-auto` を設定（停止後は少し大きめの高さ制限）。

---

## 4. 設計上の問題 🟡

### DESIGN-1: transcript が単一文字列で管理されている [Medium]

**場所**: `web/src/hooks/useSpeechRecognition.ts` L107-117

```tsx
setTranscript((prev) => {
  if (prev) {
    return prev + " " + newText;
  }
  return newText;
});
```

**問題**:
- transcript は累積的な単一 `string` として管理されている
- 「最新3〜5文」だけを表示するには、文字列を分割する必要がある
- `transcriptSegments` 配列は存在するが、`enableSpeakerDiarization = true` の場合のみ使われる

**改善案**: 
- Issue の要件「最新3〜5文に限定して表示」を実現するには、全文を保持しつつ表示用に末尾N文を切り出す必要がある
- 方法A: `transcript.split(/[。.！!？?\n]/).slice(-5)` で末尾5文を切り出し（簡易）
- 方法B: `transcriptSegments` を常に使い、最新N件のみ表示（より堅牢だが大きな変更）
- **推奨**: Phase 1 では方法Aを採用し、Phase 2 で方法Bにリファクタリング

---

### DESIGN-2: 翻訳テキストの原文表示が冗長 [Low]

**場所**: `web/src/app/page.tsx` L712-730（翻訳タブ内の原文セクション）

```tsx
<div>
  <p className="text-sm text-gray-500">原文（...）:</p>
  <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
    {transcript}
  </div>
</div>
```

**問題**: 翻訳タブで transcript（原文）も全文表示しており、transcript タブとの重複。長文では翻訳タブ自体が非常に長くなる。

**改善案**: 翻訳タブの原文セクションはデフォルトで折りたたみ（collapse）にする。

---

### DESIGN-3: useRef が import されているが scroll 用途では未使用 [Info]

**場所**: `web/src/app/page.tsx` L3

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
```

**問題**: `useRef` は import されているが、scroll コンテナ参照には使われていない。現在は `lastTranslatedTextRef` と `translationTimeoutRef` のみに使用。

**✅ Good**: `useRef` は既に import 済みなので、scroll 用の ref 追加は import 変更不要。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #4 (自動追従)  ──→  Issue #3 (リアルタイム翻訳精度) [弱い依存]
  └─ 理由: 翻訳タブの自動追従は翻訳テキストの更新タイミングに依存
  └─ 対策: 翻訳テキスト更新時も scroll を bottom に設定すれば問題なし

Issue #4 (自動追従)  ──→  Issue #9 (話者識別) [設計影響]
  └─ 理由: 話者識別が実装されると transcript の表示フォーマットが変わる
  └─ 対策: scroll 制御は表示内容に依存しないため、互換性あり

Issue #4 (自動追従)  ⊥   Issue #8 (多言語対応 i18n) [独立]
Issue #4 (自動追従)  ⊥   Issue #6 (議事録テンプレート) [独立]
```

**結論**: Issue #4 は **ブロッカーなし**、並行作業可能。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---|---|---|---|
| scroll 制御 | Radix Tabs (DOM 構造) | Low | TabsContent 内の div に ref を付与するだけ |
| 自動追従 toggle | なし | None | 独立した state で管理 |
| 手動スクロール検知 | `onScroll` イベント | Low | デバウンス付きで実装 |
| 最新N文表示 | transcript 文字列形式 | Medium | 日本語の文区切り（。）と英語の区切り（. ）を考慮 |

### 5.3 他 Issue/機能との相互作用

- **Issue #9 (話者識別)**: 話者識別実装後は `[話者1] テキスト` 形式になるが、scroll 制御は表示内容非依存のため **干渉なし**。
- **Issue #3 (翻訳精度)**: 翻訳テキスト更新頻度が変わっても scroll 制御は `useEffect` で追従するため **干渉なし**。
- **PR #18 (FSM)**: `showRecordingUI` の状態遷移は scroll 制御のトリガーには使用しないため **干渉なし**。

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|---|---|---|
| Chrome (Desktop) | `scrollTo`, `onScroll` 完全対応 | None |
| Safari (Desktop) | 同上 | None |
| Firefox | 同上 | None |
| Safari (iOS) | `scroll-behavior: smooth` がパフォーマンスに影響する可能性 | Low |
| Chrome (Android) | 同上 | Low |
| Edge | Chrome ベースのため同等 | None |

**結論**: 使用する Web API (`scrollTop`, `scrollHeight`, `onScroll`) は全モダンブラウザで完全対応。リスクなし。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）— 自動追従の実装

#### 7.1 新規 state / ref の追加

**場所**: `web/src/app/page.tsx` — state 宣言セクション

```tsx
// Auto-scroll / follow control
const [autoFollow, setAutoFollow] = useState(true);
const transcriptScrollRef = useRef<HTMLDivElement>(null);
const translationScrollRef = useRef<HTMLDivElement>(null);
```

#### 7.2 自動スクロール useEffect

```tsx
// Auto-scroll to bottom when transcript updates
useEffect(() => {
  if (autoFollow && transcriptScrollRef.current) {
    const el = transcriptScrollRef.current;
    el.scrollTop = el.scrollHeight;
  }
}, [transcript, interimTranscript, autoFollow]);

// Auto-scroll translation tab
useEffect(() => {
  if (autoFollow && translationScrollRef.current) {
    const el = translationScrollRef.current;
    el.scrollTop = el.scrollHeight;
  }
}, [translatedText, autoFollow]);
```

#### 7.3 手動スクロール検知

```tsx
const handleTranscriptScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
  const el = e.currentTarget;
  // ユーザーが bottom から 50px 以上離れたら auto-follow を停止
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  if (!isAtBottom) {
    setAutoFollow(false);
  }
}, []);
```

#### 7.4 スクロールコンテナの設定

録音中の transcript 表示（L634-650 付近）:

```tsx
<div className="space-y-2">
  <div
    ref={transcriptScrollRef}
    onScroll={handleTranscriptScroll}
    className="max-h-[400px] overflow-y-auto"
  >
    {transcript && (
      <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
        {transcript}
      </div>
    )}
    {interimTranscript && (
      <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-blue-600 italic">
        {interimTranscript}
      </div>
    )}
  </div>
  {/* ... waiting message ... */}
</div>
```

翻訳表示にも同様に `ref={translationScrollRef}` + `max-h-[400px] overflow-y-auto` を適用。

#### 7.5 Follow トグルボタン

```tsx
{showRecordingUI && !autoFollow && (
  <button
    onClick={() => setAutoFollow(true)}
    className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-lg hover:bg-blue-700 transition-colors"
  >
    ↓ 最新に追従
  </button>
)}
```

#### 7.6 録音開始時に autoFollow をリセット

`handleStartRecording` 内:

```tsx
setAutoFollow(true);
```

#### 7.7 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `web/src/app/page.tsx` | state/ref 追加、scroll コンテナ設定、auto-scroll useEffect、Follow トグル UI |

**新規ファイル不要**。

---

### Phase 2: 設計改善（P1）— 最新N文表示

#### 7.8 表示用テキスト切り出しユーティリティ

```tsx
function getRecentSentences(text: string, count: number = 5): string {
  // 日本語の句点「。」と英語のピリオド「. 」で分割
  const sentences = text.split(/(?<=[。.!?！？])\s*/);
  if (sentences.length <= count) return text;
  return "..." + sentences.slice(-count).join(" ");
}
```

録音中の表示で使用：

```tsx
<div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
  {getRecentSentences(transcript, 5)}
</div>
```

**注意**: 全文データは `transcript` state に保持したまま、表示のみ制限する。保存時は全文を送信。

---

### Phase 3: 堅牢性強化（P2）

#### 7.9 パフォーマンス最適化

- `handleTranscriptScroll` に 100ms のデバウンスを追加（scroll イベントの高頻度発火対策）
- `getRecentSentences` の結果を `useMemo` でキャッシュ

#### 7.10 録音停止後の表示改善

- 停止後の transcript 表示にも `max-h-[600px] overflow-y-auto` を設定
- 翻訳タブの原文セクションを折りたたみ可能にする

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|---|---|
| 録音開始 → autoFollow = true | scroll が bottom に固定 |
| 手動スクロール（上方向） | autoFollow = false に変化 |
| autoFollow=false → 「最新に追従」クリック | autoFollow = true、scroll が bottom に戻る |
| 手動スクロール → bottom 付近 (< 50px) | autoFollow は false のまま（明示的な操作が必要） |
| 新しい録音開始 | autoFollow = true にリセット |
| タブ切り替え（文字起こし → 翻訳） | 翻訳タブでも auto-follow が機能 |

### 8.2 統合テスト

| シナリオ | 確認事項 |
|---|---|
| 30分間の連続録音 | transcript が 400px 内でスクロール可能、最新テキストが見える |
| リアルタイム翻訳 ON で長時間録音 | 翻訳タブでも自動追従が機能 |
| 途中でページリロードなし | transcript データの整合性 |
| 一時停止 → 再開 | auto-follow 状態が維持される |

### 8.3 手動テスト

| ブラウザ | テスト項目 |
|---|---|
| Chrome Desktop | 基本動作、smooth scroll |
| Safari Desktop | scroll コンテナの挙動 |
| Chrome Android | タッチスクロールでの auto-follow 停止 |
| Safari iOS | タッチスクロール + smooth scroll のパフォーマンス |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|---|---|---|---|
| 1 | `feature/fix-auto-scroll` ブランチ作成 | 1分 | Git |
| 2 | state / ref 追加 (`autoFollow`, `transcriptScrollRef`, `translationScrollRef`) | 5分 | page.tsx |
| 3 | transcript 表示エリアに scroll コンテナ設定 (`max-h`, `overflow-y-auto`, `ref`) | 10分 | page.tsx L634-660 |
| 4 | 翻訳表示エリアに同様の scroll コンテナ設定 | 5分 | page.tsx L695-730 |
| 5 | auto-scroll `useEffect` 追加 (transcript + translation) | 5分 | page.tsx |
| 6 | 手動スクロール検知 (`handleTranscriptScroll`) | 5分 | page.tsx |
| 7 | Follow トグルボタン UI | 5分 | page.tsx |
| 8 | 録音開始時の `setAutoFollow(true)` リセット | 1分 | page.tsx |
| 9 | 録音停止後の表示にも `max-h` 設定 | 3分 | page.tsx |
| 10 | 動作確認 + デプロイ + PR 作成 | 15分 | — |
| **合計** | | **約55分** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|---|---|---|---|
| scroll イベントの高頻度発火によるパフォーマンス低下 | Medium | Low | デバウンス (100ms) を適用 |
| `scrollTop = scrollHeight` が Radix TabsContent の DOM 構造で機能しない | Low | High | ref を TabsContent 直下の div に付与して回避 |
| smooth scroll が iOS Safari でカクつく | Low | Low | `scroll-behavior: auto`（即座にスクロール）をデフォルトにする |
| 最新N文表示で日本語文区切りが不正確 | Medium | Low | 保守的に5文以上表示し、全文は scroll で閲覧可能 |
| autoFollow の state が transcript と translation で共有されている点 | Low | Medium | Phase 2 で個別の state に分離可能 |

---

## 11. 結論

### 最大の問題点

**文字起こし/翻訳の表示コンテナに `max-height` も `overflow` も設定されておらず、自動スクロールのロジックが一切存在しない。** これはコア機能（リアルタイム文字起こし）のUXを完全に破綻させるCriticalバグである。

### 推奨する修正順序

1. **Phase 1 (P0)**: scroll コンテナ設定 + auto-scroll + Follow トグル → **必須・即時対応**
2. **Phase 2 (P1)**: 最新N文表示（`getRecentSentences`）→ パフォーマンス改善
3. **Phase 3 (P2)**: デバウンス最適化 + 停止後表示改善 → 堅牢性強化

### 他 Issue への影響サマリー

- Issue #3 (翻訳精度): 干渉なし
- Issue #8 (i18n): 干渉なし
- Issue #9 (話者識別): 干渉なし（scroll 制御は表示内容非依存）
- Issue #6 (議事録テンプレート): 干渉なし

### 判定

## **🟢 GO**

修正は `web/src/app/page.tsx` の **1ファイルのみ** に限定され、既存の state/hook 構造を壊さない。ブロッカーとなる他 Issue もなく、即時着手可能。Phase 1 の実装工数は約40分と見積もる。
