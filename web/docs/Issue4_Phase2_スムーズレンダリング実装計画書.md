# Issue #4 Phase 2: スムーズスクロール＆セグメント分割レンダリング実装計画書

**Issue**: [#4](https://github.com/hidetoshihonda/airecorder/issues/4)  
**作成日**: 2026-02-08  
**ステータス**: Phase 1 完了（PR #21）→ Phase 2 計画  
**ブランチ**: `feature/smooth-transcript-rendering`

---

## 1. エグゼクティブサマリー

Phase 1（PR #21）で自動追従スクロールは実装済みだが、**リアルタイム文字起こし中にテキスト全体が再描画されることによる「リフレッシュ感」** が残存している。

本計画では、transcript の内部データ構造を **単一文字列 (`string`) → セグメント配列 (`string[]`)** に変更し、React の差分レンダリングにより **新しいセグメントだけを DOM に追加** するアーキテクチャに刷新する。これにより再描画のフラッシュを完全に排除し、プロダクション品質のスムーズなリアルタイム表示を実現する。

---

## 2. 現状分析：なぜ「リフレッシュ感」が生じるか

### 2.1 現在のデータフロー

```
Azure Speech SDK
  ↓ recognized event（新しい文を認識）
  
useSpeechRecognition.ts:
  setTranscript(prev => prev + " " + newText)  ← 全文を結合した1本の string
  ↓
  
page.tsx:
  <div>{transcript}</div>  ← string 全体が変わるので div 全体を再描画
  ↓
  
useEffect:
  el.scrollTop = el.scrollHeight  ← DOM 更新後にスクロール（タイミングずれ可能性あり）
```

### 2.2 問題の本質（3層構造）

| 層 | 問題 | 影響 |
|---|---|---|
| **データ層** | `transcript` が単一 `string`。1文追加 = 全文字列が新しいオブジェクト | React が差分検出不能 → 全描画 |
| **レンダリング層** | `{transcript}` を1つの Text Node として描画 | 1文字でも変わると Text Node 全体を置換 |
| **スクロール層** | `scroll-smooth` + `useEffect` の二重処理 | DOM 更新とスクロールのタイミング競合 |

### 2.3 理想のデータフロー（After）

```
Azure Speech SDK
  ↓ recognized event
  
useSpeechRecognition.ts:
  setTranscriptSegments(prev => [...prev, newText])  ← 配列に push
  transcript = segments.join(" ")  ← 後方互換のために fullText も提供
  ↓

page.tsx:
  {segments.map((s, i) => <p key={i}>{s}</p>)}  ← 新しい <p> だけ追加、既存 DOM 不変
  <div ref={anchorRef} />  ← overflow-anchor でブラウザネイティブ追従
```

**結果**: 既存の DOM ノードに一切触れないため、フラッシュ・ちらつきが **完全に消える**。

---

## 3. アーキテクチャ設計

### 3.1 変更対象のコンポーネント依存図

```
useSpeechRecognition.ts  [変更: セグメント配列を primary data に]
  ↓ segments: string[]
  ↓ transcript: string (= segments.join, 後方互換)
  ↓ interimTranscript: string (変更なし)
  
page.tsx  [変更: セグメント単位のレンダリング]
  ├── 録音中表示: segments.map() + overflow-anchor
  ├── auto-scroll: rAF ベース（scroll-smooth 廃止）
  ├── 保存: transcript (fullText) を使用 → 変更なし
  ├── 翻訳: transcript (fullText) を使用 → 変更なし
  └── コピー: transcript (fullText) を使用 → 変更なし

summaryApi.ts  [変更なし: transcript string を受け取る]
recordingsApi.ts  [変更なし: Transcript 型 (fullText + segments) を受け取る]
export.ts  [変更なし: recording.transcript.fullText を使用]
RecordingContext.tsx  [変更なし: 保存済み Recording 型を使用]
recording/page.tsx  [変更なし: 保存済み recording.transcript.fullText を使用]
```

### 3.2 設計原則

1. **後方互換性**: `transcript: string` は引き続き提供する。既存の保存・翻訳・コピー・議事録生成はすべて `transcript` (string) を参照しているため、**消費側の変更はゼロ**。
2. **Primary Data Source の変更**: `transcriptSegments: string[]` が primary、`transcript: string` は derived value とする。
3. **現行の `TranscriptSegment` 型との整理**: 現在 `useSpeechRecognition.ts` 内に `TranscriptSegment` インターフェース（`speaker`, `text`, `timestamp`）があり、`enableSpeakerDiarization` 時のみ使用されている。今回は **話者識別なしでも常にセグメント配列を使う** 設計にする。Issue #9（話者識別）実装時にこの配列に `speaker` フィールドを自然に追加できる。
4. **overflow-anchor**: ブラウザネイティブの scroll anchoring を活用し、JavaScript による `scrollTop` 設定を最小化する。

---

## 4. 詳細実装計画

### Step 1: `useSpeechRecognition.ts` — セグメント配列を Primary Data に変更

**ファイル**: `web/src/hooks/useSpeechRecognition.ts`

#### 4.1.1 Return 型の拡張

```typescript
interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isPaused: boolean;
  transcript: string;              // 後方互換: segments.join(" ")
  transcriptSegments: TranscriptSegment[];  // 既存（話者識別用）
  interimTranscript: string;
  /** 新規追加: 確定済みテキストのセグメント配列（話者識別なし時も使用） */
  segments: string[];
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
}
```

#### 4.1.2 内部 state の変更

```typescript
// Before
const [transcript, setTranscript] = useState("");

// After
const [segments, setSegments] = useState<string[]>([]);
// transcript は derived (useMemo)
const transcript = useMemo(() => segments.join(" "), [segments]);
```

#### 4.1.3 `recognized` イベントハンドラの変更

```typescript
// Before
recognizer.recognized = (_sender, event) => {
  if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
    const newText = event.result.text;
    setTranscript((prev) => prev ? prev + " " + newText : newText);
    setInterimTranscript("");
  }
};

// After
recognizer.recognized = (_sender, event) => {
  if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
    const newText = event.result.text;
    setSegments((prev) => [...prev, newText]);
    setInterimTranscript("");
    
    // 話者識別有効時は TranscriptSegment も追加（既存ロジック維持）
    if (enableSpeakerDiarization) { /* ... existing code ... */ }
  }
};
```

#### 4.1.4 `resetTranscript` の変更

```typescript
const resetTranscript = useCallback(() => {
  setSegments([]);
  setTranscriptSegments([]);
  setInterimTranscript("");
  pausedTranscriptRef.current = "";
  currentSpeakerRef.current = "話者1";
}, []);
```

#### 4.1.5 `pauseListening` の変更

```typescript
// pausedTranscriptRef は削除可能（segments が immutable な配列なので pause/resume 間で安全）
// ただし後方互換のため、pausedTranscriptRef.current の使用箇所を確認して安全に削除
```

**影響範囲**: このフックの return に `segments: string[]` を追加するだけ。`transcript: string` は引き続き提供するので、**消費側の変更はゼロ**。

---

### Step 2: `page.tsx` — セグメント分割レンダリング

**ファイル**: `web/src/app/page.tsx`

#### 4.2.1 フック呼び出しの変更

```typescript
const {
  isListening,
  isPaused,
  transcript,
  segments,           // ← 新規追加
  interimTranscript,
  error: speechError,
  startListening,
  stopListening,
  pauseListening,
  resumeListening,
  resetTranscript,
} = useSpeechRecognition({ /* ... */ });
```

#### 4.2.2 録音中の文字起こし表示（核心部分）

```tsx
{/* Before: 全文を1つの div でレンダリング */}
<div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
  {transcript}
</div>

{/* After: セグメント単位のレンダリング + overflow-anchor */}
<div
  ref={transcriptScrollRef}
  onScroll={handleScrollContainer}
  className="max-h-[400px] overflow-y-auto"
>
  <div className="rounded-md bg-gray-50 p-4 text-gray-800">
    {segments.map((seg, i) => (
      <span key={i} className="inline">
        {i > 0 && " "}
        {seg}
      </span>
    ))}
  </div>
  {interimTranscript && (
    <div className="rounded-md bg-blue-50 p-4 text-blue-600 italic mt-1">
      {interimTranscript}
    </div>
  )}
  {/* Scroll Anchor: ブラウザネイティブの scroll anchoring */}
  <div ref={scrollAnchorRef} className="h-px" style={{ overflowAnchor: 'auto' }} />
</div>
```

**ポイント**:
- `key={i}` は segments が append-only なので安定した key として機能する
- `<span>` を使うことで、既存の `<span>` ノードは DOM 上で一切変更されない
- 新しい segment が追加されると、React は **最後の `<span>` だけを DOM に insert** する
- `overflow-anchor` アンカーが最下部にあるため、ブラウザが自動的にスクロール位置を維持

#### 4.2.3 auto-scroll を `requestAnimationFrame` ベースに変更

```typescript
// Before
useEffect(() => {
  if (autoFollow && transcriptScrollRef.current) {
    const el = transcriptScrollRef.current;
    el.scrollTop = el.scrollHeight;
  }
}, [transcript, interimTranscript, autoFollow]);

// After
useEffect(() => {
  if (autoFollow && transcriptScrollRef.current) {
    requestAnimationFrame(() => {
      if (transcriptScrollRef.current) {
        transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
      }
    });
  }
}, [segments.length, interimTranscript, autoFollow]);
// ↑ segments.length を依存配列に（segments 参照だと毎回変わるため）
```

#### 4.2.4 `scroll-smooth` クラスの削除

```diff
- className="max-h-[400px] overflow-y-auto space-y-2 scroll-smooth"
+ className="max-h-[400px] overflow-y-auto"
```

**理由**: 高頻度更新では smooth scroll がアニメーションをキューイングし、ガクガクする。`requestAnimationFrame` でインスタントスクロールに切り替えることで、体感的にはむしろ自然になる。

#### 4.2.5 翻訳タブも同様に `scroll-smooth` 削除 + `rAF`

翻訳テキストはセグメント分割しない（翻訳 API は全文を一括で返すため）。ただし `scroll-smooth` 削除と `rAF` は適用する。

#### 4.2.6 保存処理（変更なし）

```typescript
// handleSave 内 — transcript (string) を使うので変更不要
transcript: {
  segments: [{
    id: "1",
    text: transcript,      // ← useMemo で segments.join(" ") した string
    startTime: 0,
    endTime: duration,
  }],
  fullText: transcript,    // ← 同上
},
```

将来的には保存時にも `segments` 配列を活用し、各セグメントに `startTime`/`endTime` を付与できるが、それは Issue #9（話者識別）と合わせて実装する。

---

### Step 3: 即時改善（`scroll-smooth` 削除 + `rAF`）

Phase 2 のセグメント分割と独立して、**即座に適用可能な改善**。

| 変更 | ファイル | 工数 |
|---|---|---|
| `scroll-smooth` クラス削除 | `page.tsx` | 1分 |
| `useEffect` 内を `requestAnimationFrame` でラップ | `page.tsx` | 2分 |
| `overflow-anchor` アンカー要素追加 | `page.tsx` | 2分 |

---

## 5. 変更ファイル一覧

| ファイル | 変更内容 | 影響度 |
|---|---|---|
| `web/src/hooks/useSpeechRecognition.ts` | `segments: string[]` を primary data に、`transcript` を derived に | **High** |
| `web/src/app/page.tsx` | セグメント分割レンダリング、rAF スクロール、anchor | **High** |
| `web/src/app/page.tsx` | `scroll-smooth` 削除 | **Low** |

### 変更が**不要**なファイル（後方互換性により）

| ファイル | 理由 |
|---|---|
| `web/src/services/recordingsApi.ts` | `transcript: string` で保存（変更なし） |
| `web/src/services/summaryApi.ts` | `transcript: string` で議事録生成（変更なし） |
| `web/src/lib/export.ts` | `recording.transcript.fullText` で出力（変更なし） |
| `web/src/contexts/RecordingContext.tsx` | 保存済み `Recording` 型を扱う（変更なし） |
| `web/src/app/recording/page.tsx` | 保存済み `recording.transcript.fullText` を表示（変更なし） |
| `web/src/types/index.ts` | `Transcript`, `TranscriptSegment` 型は変更なし |
| `web/src/hooks/useAudioRecorder.ts` | 音声録音のみ、transcript 非依存（変更なし） |
| `web/src/hooks/useRecordingStateMachine.ts` | FSM のみ、transcript 非依存（変更なし） |

---

## 6. Issue #9（話者識別）との統合設計

セグメント配列化は Issue #9 の**前提条件**として機能する。

### 6.1 現在（本計画）

```typescript
// useSpeechRecognition return
segments: string[]  // ["こんにちは。", "今日の会議を始めます。", ...]
```

### 6.2 Issue #9 実装時（将来）

```typescript
// 型を拡張
interface LiveSegment {
  text: string;
  speaker?: string;     // "話者1", "話者2", ...
  timestamp?: number;
}

// useSpeechRecognition return
segments: LiveSegment[]  // [{ text: "こんにちは。", speaker: "話者1" }, ...]
```

### 6.3 表示の進化

```tsx
// 現在（本計画）
{segments.map((seg, i) => (
  <span key={i}>{seg}</span>
))}

// Issue #9 実装後
{segments.map((seg, i) => (
  <div key={i} className="flex gap-2">
    {seg.speaker && <span className="text-blue-600 font-bold">{seg.speaker}</span>}
    <span>{seg.text}</span>
  </div>
))}
```

セグメント配列化を先に行うことで、Issue #9 は**表示側の変更だけ**で済む。

---

## 7. テスト計画

### 7.1 ユニットテスト（手動確認）

| テストケース | 期待結果 |
|---|---|
| 認識イベント発火 → segments に push される | segments.length が1増加 |
| transcript が segments.join(" ") と一致 | 後方互換性の確認 |
| resetTranscript → segments が空配列 | リセット動作 |
| pause → resume → 新しい segment 追加 | 既存 segments が保持される |

### 7.2 レンダリングテスト（DevTools Performance）

| テストケース | 期待結果 |
|---|---|
| 新しい segment 追加時の DOM 変更ノード数 | 1（新しい `<span>` のみ） |
| 既存 segment の DOM ノード | 変更なし（React DevTools Highlight Updates で確認） |
| 30分録音（600+ segments）でのスクロール | ガクつきなし |
| 手動スクロール → autoFollow 停止 | 位置ジャンプなし |

### 7.3 統合テスト

| テストケース | 期待結果 |
|---|---|
| 録音 → 停止 → 保存 | `transcript.fullText` に全文が保存される |
| 録音 → リアルタイム翻訳 | translatedText が正しく更新される |
| 録音 → 停止 → 議事録生成 | `transcript` (string) が API に送信される |
| 録音 → コピーボタン | クリップボードに全文がコピーされる |

---

## 8. 実装ロードマップ

| Step | 作業内容 | 見積り | リスク |
|---|---|---|---|
| 1 | ブランチ作成 `feature/smooth-transcript-rendering` | 1分 | — |
| 2 | `useSpeechRecognition.ts`: `segments` state 追加、`transcript` を `useMemo` derived に変更 | 15分 | Medium: pause/resume 時の segment 保持を確認 |
| 3 | `useSpeechRecognition.ts`: `recognized` ハンドラで `setSegments` を使用 | 5分 | Low |
| 4 | `useSpeechRecognition.ts`: return に `segments` を追加 | 2分 | — |
| 5 | `page.tsx`: `segments` を受け取り、録音中表示をセグメント分割レンダリングに変更 | 15分 | Low |
| 6 | `page.tsx`: `scroll-smooth` 削除、`rAF` ベースのスクロールに変更 | 5分 | — |
| 7 | `page.tsx`: `overflow-anchor` アンカー要素追加 | 3分 | Low: ブラウザ互換性確認 |
| 8 | `page.tsx`: auto-scroll の依存配列を `segments.length` に変更 | 2分 | — |
| 9 | ビルド確認 (`next build`) | 2分 | — |
| 10 | 動作テスト（録音 → 表示 → 保存 → 翻訳） | 10分 | — |
| 11 | デプロイ + PR 作成 | 5分 | — |
| **合計** | | **約65分** | |

---

## 9. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|---|---|---|---|
| `segments.join(" ")` が既存の `transcript` と微妙に異なる | Low | High | テストで保存/翻訳/コピーの全パスを検証 |
| `useMemo` の再計算コスト（segments が大きい場合） | Low | Low | 30分録音で600 segments 程度。join は O(n) で十分高速 |
| `overflow-anchor` が Safari で未対応 | Low | Medium | フォールバックとして `rAF` + `scrollTop` を維持 |
| `key={i}` が安全かどうか（segments は append-only か） | Low | Medium | `resetTranscript` 時は全クリアなので問題なし。中間挿入は設計上ない |
| pause 中の segment 状態保持 | Medium | High | pause は SDK の `stopContinuousRecognition` を呼ぶだけ。segments state は React 側で保持されるので安全 |

---

## 10. 判定

### 🟢 GO

- 影響範囲は **2ファイル** に限定（`useSpeechRecognition.ts` + `page.tsx`）
- 後方互換性により、保存・翻訳・コピー・議事録生成・エクスポートの **全消費側は変更不要**
- Issue #9（話者識別）への拡張パスも確保
- 即時改善（`scroll-smooth` 削除 + `rAF`）はセグメント分割と独立して適用可能
- 推定工数 65分、リスクは全て対策可能
