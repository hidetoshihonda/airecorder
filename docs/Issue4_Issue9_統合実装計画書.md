# Issue #4 Phase 2 + Issue #9 統合実装計画書
# セグメント分割レンダリング × 話者識別（ConversationTranscriber）

**Issue**: [#4](https://github.com/hidetoshihonda/airecorder/issues/4) + [#9](https://github.com/hidetoshihonda/airecorder/issues/9)  
**作成日**: 2026-02-08  
**ステータス**: 計画  
**ブランチ**: `feature/segment-rendering-with-diarization`

---

## 1. エグゼクティブサマリー

Issue #4 Phase 2（セグメント分割レンダリングによるスムーズ表示）と Issue #9（ConversationTranscriber による話者識別）は、**transcript のデータ構造を `string` → 構造化セグメント配列に変更する** という同一の基盤作業を必要とする。

これらを**別々に実装すると**：
1. Phase 2 で `segments: string[]` に変更 → Issue #9 で `segments: LiveSegment[]` に再変更（**二度手間**）
2. useSpeechRecognition の大改修が **2回** 必要になる
3. page.tsx の表示ロジックも **2回** 書き換えが発生する

本計画では、**一度の基盤設計で両方を同時に実現する**。

### 統合による効果

| 項目 | 個別実装 | 統合実装 | 削減 |
|---|---|---|---|
| useSpeechRecognition 改修回数 | 2回 | **1回** | -50% |
| page.tsx 表示ロジック変更回数 | 2回 | **1回** | -50% |
| 合計工数 | ~20h (65min + 19h) | **~16h** | -20% |
| リグレッションリスク | 高（2回の破壊的変更） | **低（1回の変更）** | — |

---

## 2. 現状の問題と統合ゴール

### 2.1 Issue #4 Phase 2 の課題

```
現状: transcript = "こんにちは。 今日の会議を始めます。 ..."  (単一 string)
       ↓ React が全体を再描画 → フラッシュ・ちらつき
```

### 2.2 Issue #9 の課題

```
現状: enableSpeakerDiarization = true の場合
      → 沈黙時間2秒で話者を推定（不正確）
      → Azure ConversationTranscriber を使えば声紋ベースの正確な識別が可能
```

### 2.3 統合後のゴール

```
After:  segments = [
          { id: "seg-1", text: "こんにちは。", speaker: "Guest-1", timestamp: 0 },
          { id: "seg-2", text: "始めましょう。", speaker: "Guest-2", timestamp: 5200 },
          ...
        ]
        ↓ React が新しい <div key="seg-2"> だけを追加（既存 DOM 不変）
        ↓ 話者ごとに色分けされたバブル表示
        ↓ overflow-anchor でブラウザネイティブ追従
```

---

## 3. 統合アーキテクチャ設計

### 3.1 新しい LiveSegment 型

```typescript
// types/index.ts に追加
export interface LiveSegment {
  /** ユニーク ID（React key として使用） */
  id: string;
  /** 確定テキスト */
  text: string;
  /** 話者 ID（ConversationTranscriber: "Guest-1" 等、通常モード: undefined） */
  speaker?: string;
  /** 話者ラベル（ユーザーが設定した表示名、例: "田中さん"） */
  speakerLabel?: string;
  /** 発話開始タイムスタンプ（ms, 録音開始からの相対） */
  timestamp: number;
  /** 発話時間（ms） */
  duration?: number;
}
```

### 3.2 コンポーネント依存関係（After）

```
page.tsx (HomePage)
├── useSpeechRecognition() ← 大改修
│   ├── mode: "standard" → SpeechRecognizer（従来通り）
│   │   └── return: segments: LiveSegment[] (speaker=undefined)
│   ├── mode: "diarization" → ConversationTranscriber（新規）
│   │   └── return: segments: LiveSegment[] (speaker="Guest-N")
│   ├── transcript: string (= segments.map(s => s.text).join(" "), derived)
│   └── interimTranscript: string (変更なし)
│
├── useSpeakerManager() ← 新規フック
│   ├── speakers: Map<string, SpeakerInfo>
│   ├── renameSpeaker(id, label): void
│   └── getSpeakerColor(id): SpeakerColor
│
├── <TranscriptView /> ← 新規コンポーネント
│   ├── segments: LiveSegment[] を受け取り
│   ├── セグメント単位レンダリング（差分 DOM 更新）
│   ├── 話者ごとの色分けバブル表示
│   ├── overflow-anchor による自動追従
│   └── autoFollow / Follow トグル
│
├── 保存・翻訳・コピー・議事録 → transcript (string) を使用（変更なし）
└── 翻訳タブ → translatedText 表示（scroll 改善のみ）
```

### 3.3 データフロー（After）

```
                    ┌────────────────────────────┐
                    │  enableDiarization = false  │
                    │  → SpeechRecognizer         │
                    │  recognized event:          │
                    │    setSegments(prev => [    │
                    │      ...prev,               │
                    │      { id, text }           │ ← speaker なし
                    │    ])                        │
                    └────────────┬───────────────┘
                                 │
 Azure Speech SDK ──→ useSpeechRecognition ──→ segments: LiveSegment[]
                                 │                       │
                    ┌────────────┴───────────────┐       │
                    │  enableDiarization = true   │       │
                    │  → ConversationTranscriber  │       │
                    │  transcribed event:         │       │
                    │    setSegments(prev => [    │       │
                    │      ...prev,               │       │
                    │      { id, text, speaker,   │       │
                    │        timestamp, duration } │       │
                    │    ])                        │       │
                    └────────────────────────────┘       │
                                                          │
                                                          ▼
                                              ┌──────────────────────┐
                                              │  page.tsx             │
                                              │                      │
                                              │  transcript =        │
                                              │   segments           │
                                              │    .map(s => s.text) │
                                              │    .join(" ")        │
                                              │  (derived, 後方互換) │
                                              │                      │
                                              │  <TranscriptView     │
                                              │    segments={segments}│
                                              │    speakers={...}    │
                                              │  />                  │
                                              └──────────────────────┘
```

---

## 4. 実装フェーズ

### Phase A: 基盤（セグメント配列化 + スムーズレンダリング）

Issue #4 Phase 2 の核心。**話者識別を有効にしなくても恩恵がある**。

### Phase B: ConversationTranscriber 統合

Issue #9 の核心。Phase A の基盤の上に構築。

### Phase C: 話者管理 UI + ラベリング

Issue #9 の UX 層。

### Phase D: 既存機能との統合・磨き上げ

翻訳・保存・議事録との連携、パフォーマンス最適化。

---

## 5. 詳細実装計画

### ═══════════════════════════════════════
### Phase A: 基盤（セグメント配列化）— 約2時間
### ═══════════════════════════════════════

#### Step A-1: `LiveSegment` 型の定義

**ファイル**: `web/src/types/index.ts`

```typescript
// 既存の TranscriptSegment とは別に、リアルタイム表示用の型を定義
// TranscriptSegment は保存済み Recording 用、LiveSegment はリアルタイム用
export interface LiveSegment {
  id: string;
  text: string;
  speaker?: string;
  speakerLabel?: string;
  timestamp: number;
  duration?: number;
}
```

**理由**: 既存の `TranscriptSegment`（`types/index.ts` L23）は保存用の型（`startTime`, `endTime`, `confidence` を持つ）であり、リアルタイム表示に必要な `speaker` の扱いが異なる。責務分離のため新しい型を作る。

**工数**: 5分

---

#### Step A-2: `useSpeechRecognition.ts` — segments を Primary Data に

**ファイル**: `web/src/hooks/useSpeechRecognition.ts`

##### 変更点1: state の変更

```typescript
// Before
const [transcript, setTranscript] = useState("");
const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);

// After
const [segments, setSegments] = useState<LiveSegment[]>([]);
const segmentIdRef = useRef(0);
// transcript は derived
const transcript = useMemo(
  () => segments.map(s => s.text).join(" "),
  [segments]
);
// transcriptSegments は後方互換で維持（話者識別の既存ロジック用）
const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
```

##### 変更点2: recognized イベントハンドラ

```typescript
recognizer.recognized = (_sender, event) => {
  if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
    const newText = event.result.text;
    const now = Date.now();

    // LiveSegment を追加（話者識別なしモード）
    setSegments(prev => [
      ...prev,
      {
        id: `seg-${++segmentIdRef.current}`,
        text: newText,
        timestamp: now - startTimeRef.current,
      },
    ]);

    setInterimTranscript("");

    // 話者識別の既存ロジック（enableSpeakerDiarization 時のみ、後方互換）
    if (enableSpeakerDiarization) {
      // ... existing logic for transcriptSegments ...
    }
  }
};
```

##### 変更点3: return の拡張

```typescript
return {
  isListening,
  isPaused,
  transcript,              // string (derived from segments)
  segments,                // ★ 新規: LiveSegment[]
  transcriptSegments,      // 後方互換
  interimTranscript,
  error,
  startListening,
  stopListening,
  pauseListening,
  resumeListening,
  resetTranscript,
};
```

##### 変更点4: resetTranscript

```typescript
const resetTranscript = useCallback(() => {
  setSegments([]);
  segmentIdRef.current = 0;
  setTranscriptSegments([]);
  setInterimTranscript("");
  pausedTranscriptRef.current = "";
  currentSpeakerRef.current = "話者1";
}, []);
```

**工数**: 20分

---

#### Step A-3: `TranscriptView` コンポーネント作成

**ファイル**: `web/src/components/TranscriptView.tsx`（新規）

```tsx
"use client";

import { useRef, useEffect, useCallback, useState, memo } from "react";
import { ArrowDown } from "lucide-react";
import { LiveSegment } from "@/types";

// 話者カラーパレット（Issue #9 で使用、話者なし時は不使用）
const SPEAKER_COLORS = [
  { bg: "bg-blue-50", border: "border-l-blue-400", label: "text-blue-700" },
  { bg: "bg-green-50", border: "border-l-green-400", label: "text-green-700" },
  { bg: "bg-purple-50", border: "border-l-purple-400", label: "text-purple-700" },
  { bg: "bg-orange-50", border: "border-l-orange-400", label: "text-orange-700" },
  { bg: "bg-pink-50", border: "border-l-pink-400", label: "text-pink-700" },
  { bg: "bg-cyan-50", border: "border-l-cyan-400", label: "text-cyan-700" },
  { bg: "bg-yellow-50", border: "border-l-yellow-400", label: "text-yellow-700" },
  { bg: "bg-red-50", border: "border-l-red-400", label: "text-red-700" },
];

function getSpeakerColorIndex(speakerId: string): number {
  // "Guest-1" → 0, "Guest-2" → 1, ...
  const match = speakerId.match(/(\d+)/);
  if (match) return (parseInt(match[1]) - 1) % SPEAKER_COLORS.length;
  return 0;
}

/** 個別セグメント（memo で再描画を防止） */
const SegmentItem = memo(function SegmentItem({
  segment,
  showSpeaker,
}: {
  segment: LiveSegment;
  showSpeaker: boolean;
}) {
  if (!showSpeaker || !segment.speaker) {
    // 話者なしモード: インラインテキスト
    return <span className="inline">{segment.text} </span>;
  }

  // 話者ありモード: バブル表示
  const color = SPEAKER_COLORS[getSpeakerColorIndex(segment.speaker)];
  const label = segment.speakerLabel || segment.speaker;

  return (
    <div className={`rounded-md p-3 mb-2 border-l-4 ${color.bg} ${color.border}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-bold ${color.label}`}>{label}</span>
        {segment.timestamp !== undefined && (
          <span className="text-xs text-gray-400">
            {formatTimestamp(segment.timestamp)}
          </span>
        )}
      </div>
      <p className="text-gray-800 text-sm">{segment.text}</p>
    </div>
  );
});

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

interface TranscriptViewProps {
  segments: LiveSegment[];
  interimTranscript: string;
  showSpeaker: boolean;
  isRecording: boolean;
  maxHeight?: string;
}

export function TranscriptView({
  segments,
  interimTranscript,
  showSpeaker,
  isRecording,
  maxHeight = "400px",
}: TranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  // Auto-scroll with rAF
  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [segments.length, interimTranscript, autoFollow]);

  // Reset autoFollow when recording starts
  useEffect(() => {
    if (isRecording) {
      setAutoFollow(true);
    }
  }, [isRecording]);

  // Manual scroll detection
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (!isAtBottom && autoFollow) {
        setAutoFollow(false);
      }
    },
    [autoFollow]
  );

  const hasSpeakers = showSpeaker && segments.some((s) => s.speaker);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ maxHeight }}
        className="overflow-y-auto"
      >
        {segments.length > 0 && (
          <div
            className={
              hasSpeakers
                ? "space-y-0"
                : "whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800"
            }
          >
            {segments.map((seg) => (
              <SegmentItem key={seg.id} segment={seg} showSpeaker={hasSpeakers} />
            ))}
          </div>
        )}

        {interimTranscript && (
          <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-blue-600 italic mt-1">
            {interimTranscript}
          </div>
        )}

        {/* Scroll anchor for overflow-anchor */}
        <div ref={anchorRef} className="h-px" style={{ overflowAnchor: "auto" }} />
      </div>

      {/* Follow toggle button */}
      {!autoFollow && (
        <div className="flex justify-center mt-2">
          <button
            onClick={() => setAutoFollow(true)}
            className="flex items-center gap-1 rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowDown className="h-4 w-4" />
            最新に追従
          </button>
        </div>
      )}
    </div>
  );
}
```

**設計ポイント**:
- `SegmentItem` を `memo` でラップ → 既存セグメントは**絶対に再描画されない**
- `showSpeaker=false` 時はインライン `<span>` で従来と同じ見た目
- `showSpeaker=true` 時は話者ごとのカラーバブル表示
- `overflow-anchor` のアンカー要素で JS スクロール処理を最小化
- `rAF` でスクロールタイミングを描画サイクルに合わせる

**工数**: 30分

---

#### Step A-4: `page.tsx` — TranscriptView 導入

**ファイル**: `web/src/app/page.tsx`

##### 変更点1: import の追加

```typescript
import { TranscriptView } from "@/components/TranscriptView";
```

##### 変更点2: フック呼び出し

```typescript
const {
  isListening,
  isPaused,
  transcript,
  segments,                // ★ 新規
  interimTranscript,
  error: speechError,
  // ...
} = useSpeechRecognition({ /* ... */ });
```

##### 変更点3: 録音中の文字起こし表示を TranscriptView に置換

```tsx
{/* Before: 直接 {transcript} をレンダリング */}
{/* After: TranscriptView コンポーネント */}
<CardContent>
  {showRecordingUI ? (
    <>
      {segments.length === 0 && !interimTranscript ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="lg" />
          <span className="ml-2 text-gray-600">音声を待っています...</span>
        </div>
      ) : (
        <TranscriptView
          segments={segments}
          interimTranscript={interimTranscript}
          showSpeaker={enableSpeakerDiarization}
          isRecording={showRecordingUI}
        />
      )}
    </>
  ) : transcript ? (
    <div className="max-h-[600px] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
      {transcript}
    </div>
  ) : (
    <div className="py-8 text-center text-gray-500">
      録音を開始すると、ここにリアルタイムで文字起こし結果が表示されます
    </div>
  )}
</CardContent>
```

##### 変更点4: autoFollow 関連の state/effect 削除

Phase 1 で追加した `autoFollow`, `transcriptScrollRef`, `translationScrollRef`, `handleScrollContainer`, 関連 `useEffect` を**page.tsx から削除**。これらは `TranscriptView` コンポーネントに内包される。

##### 変更点5: 翻訳タブの scroll 改善

翻訳タブは `TranscriptView` を使わない（翻訳はセグメント単位ではないため）。ただし `scroll-smooth` を削除し `rAF` に変更する。

**工数**: 25分

---

#### Step A-5: ビルド確認・動作テスト

**工数**: 15分

---

### Phase A 合計: 約2時間
### Phase A 完了で得られるもの:
- ✅ リフレッシュ・フラッシュの完全解消
- ✅ memo によるゼロ再描画の差分 DOM 更新
- ✅ overflow-anchor + rAF のスムーズ追従
- ✅ 話者識別なしでも動作する基盤
- ✅ Issue #4 Phase 2 完了

---

### ═══════════════════════════════════════
### Phase B: ConversationTranscriber 統合 — 約5時間
### ═══════════════════════════════════════

#### Step B-0: 事前検証（Japan East 動作確認）

ConversationTranscriber が Japan East リージョンで動作するか確認。

```typescript
// 簡易検証スクリプト
const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(key, "japaneast");
const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
const transcriber = new SpeechSDK.ConversationTranscriber(speechConfig, audioConfig);
transcriber.transcribed = (s, e) => console.log(e.result.speakerId, e.result.text);
transcriber.startTranscribingAsync();
```

**動かない場合のフォールバック**: East US にリージョンを変更、またはプロキシ API 経由で転送。

**工数**: 30分

---

#### Step B-1: `useSpeechRecognition.ts` に ConversationTranscriber モードを追加

**ファイル**: `web/src/hooks/useSpeechRecognition.ts`

既存の `enableSpeakerDiarization` オプションの動作を変更：

```typescript
// enableSpeakerDiarization = false → SpeechRecognizer（現行通り）
// enableSpeakerDiarization = true  → ConversationTranscriber（新規）
```

##### ConversationTranscriber の初期化

```typescript
if (enableSpeakerDiarization) {
  const transcriber = new SpeechSDK.ConversationTranscriber(speechConfig, audioConfig);

  // 中間結果
  transcriber.transcribing = (_sender, event) => {
    if (event.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
      setInterimTranscript(event.result.text);
      // speakerId は中間結果では "Unknown" になる可能性あり
    }
  };

  // 確定結果
  transcriber.transcribed = (_sender, event) => {
    if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
      const newText = event.result.text;
      const speakerId = event.result.speakerId || "Unknown";

      setSegments(prev => [
        ...prev,
        {
          id: `seg-${++segmentIdRef.current}`,
          text: newText,
          speaker: speakerId,
          timestamp: event.result.offset ? event.result.offset / 10000 : Date.now() - startTimeRef.current,
          duration: event.result.duration ? event.result.duration / 10000 : undefined,
        },
      ]);
      setInterimTranscript("");
    }
  };

  transcriber.canceled = (_sender, event) => { /* ... */ };
  transcriber.sessionStopped = () => { /* ... */ };

  transcriberRef.current = transcriber;
  transcriber.startTranscribingAsync(
    () => setIsListening(true),
    (err) => { setError(`話者識別開始エラー: ${err}`); setIsListening(false); }
  );
}
```

##### 一時停止/再開の制限対応

ConversationTranscriber には `pause/resume` API が存在しない。対策：

```typescript
const pauseListening = useCallback(() => {
  if (enableSpeakerDiarization && transcriberRef.current) {
    // ConversationTranscriber: 停止→再作成（speakerId リセットのリスクあり）
    isPausingRef.current = true;
    transcriberRef.current.stopTranscribingAsync(
      () => { setIsPaused(true); setInterimTranscript(""); },
      (err) => { isPausingRef.current = false; setError(`一時停止エラー: ${err}`); }
    );
  } else if (recognizerRef.current) {
    // SpeechRecognizer: 従来通り
    // ... existing logic ...
  }
}, [enableSpeakerDiarization, isListening, isPaused]);

const resumeListening = useCallback(() => {
  if (enableSpeakerDiarization) {
    // 新しい ConversationTranscriber インスタンスを作成して再開
    // ⚠️ speakerId がリセットされる可能性 → UI で警告表示
    startConversationTranscriber(); // 内部ヘルパー
    setIsPaused(false);
  } else if (recognizerRef.current && isPaused) {
    // ... existing logic ...
  }
}, [enableSpeakerDiarization, isPaused]);
```

**制限事項**: 一時停止→再開で speakerId がリセットされる場合がある。これは Azure SDK の制限であり、UI に「一時停止後は話者番号がリセットされることがあります」と注記する。

**工数**: 2時間

---

#### Step B-2: 設定画面に話者識別トグルを追加

**ファイル**: `web/src/app/settings/page.tsx`

```tsx
<div className="flex items-center gap-3">
  <label className="relative inline-flex items-center cursor-pointer">
    <input
      type="checkbox"
      checked={settings.enableSpeakerDiarization}
      onChange={(e) => updateSettings({ enableSpeakerDiarization: e.target.checked })}
      className="sr-only peer"
    />
    <div className="w-11 h-6 bg-gray-200 ... peer-checked:bg-blue-600" />
    <span className="ml-3 text-sm font-medium text-gray-700">
      話者識別（Speaker Diarization）
    </span>
  </label>
  <p className="text-xs text-gray-500">
    有効にすると、複数人の発話を声紋で自動識別します。
    ⚠️ 一時停止・再開時に話者番号がリセットされることがあります。
  </p>
</div>
```

**工数**: 30分

---

#### Step B-3: `page.tsx` で enableSpeakerDiarization を設定から受け取る

```typescript
const { settings } = useAuth();
const enableSpeakerDiarization = settings.enableSpeakerDiarization ?? false;

const { segments, transcript, interimTranscript, ... } = useSpeechRecognition({
  subscriptionKey: speechConfig.subscriptionKey,
  region: speechConfig.region,
  language: sourceLanguage,
  enableSpeakerDiarization,
});

// TranscriptView に showSpeaker を渡す
<TranscriptView
  segments={segments}
  interimTranscript={interimTranscript}
  showSpeaker={enableSpeakerDiarization}
  isRecording={showRecordingUI}
/>
```

**工数**: 15分

---

#### Step B-4: UserSettings 型に enableSpeakerDiarization を追加

**ファイル**: `web/src/types/index.ts`

```typescript
export interface UserSettings {
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  autoSaveRecordings: boolean;
  noiseSuppression: boolean;
  theme: "light" | "dark" | "system";
  audioQuality: "low" | "medium" | "high";
  enableSpeakerDiarization: boolean;  // ★ 追加
}
```

**工数**: 5分

---

#### Step B-5: ビルド確認・動作テスト

2人で交互に話し、異なる speakerId で識別されることを確認。

**工数**: 30分

---

### Phase B 合計: 約5時間
### Phase B 完了で得られるもの:
- ✅ Azure ConversationTranscriber による声紋ベース話者識別
- ✅ 話者ごとのカラーバブル表示
- ✅ 設定画面での ON/OFF 切り替え
- ✅ 従来モード（話者なし）との完全互換
- ✅ Issue #9 の MVP 完了

---

### ═══════════════════════════════════════
### Phase C: 話者管理 UI + ラベリング — 約3時間
### ═══════════════════════════════════════

#### Step C-1: `useSpeakerManager.ts` フック作成

**ファイル**: `web/src/hooks/useSpeakerManager.ts`（新規）

```typescript
interface SpeakerInfo {
  id: string;           // "Guest-1", etc.
  label: string;        // ユーザー設定名（例: "田中さん"）
  color: number;        // SPEAKER_COLORS のインデックス
  segmentCount: number; // 発話回数
}

interface UseSpeakerManagerReturn {
  speakers: Map<string, SpeakerInfo>;
  renameSpeaker: (id: string, label: string) => void;
  getSpeakerLabel: (id: string) => string;
  updateFromSegments: (segments: LiveSegment[]) => void;
}

export function useSpeakerManager(): UseSpeakerManagerReturn {
  const [speakers, setSpeakers] = useState<Map<string, SpeakerInfo>>(new Map());

  const renameSpeaker = useCallback((id: string, label: string) => {
    setSpeakers(prev => {
      const next = new Map(prev);
      const info = next.get(id);
      if (info) {
        next.set(id, { ...info, label });
      }
      return next;
    });
    // LocalStorage に保存
    localStorage.setItem(`speaker-${id}`, label);
  }, []);

  // segments が更新されたら speaker 情報を同期
  const updateFromSegments = useCallback((segments: LiveSegment[]) => {
    setSpeakers(prev => {
      const next = new Map(prev);
      segments.forEach(seg => {
        if (seg.speaker && !next.has(seg.speaker)) {
          const saved = localStorage.getItem(`speaker-${seg.speaker}`);
          next.set(seg.speaker, {
            id: seg.speaker,
            label: saved || seg.speaker,
            color: next.size,
            segmentCount: 0,
          });
        }
      });
      // segmentCount を更新
      next.forEach((info, id) => {
        info.segmentCount = segments.filter(s => s.speaker === id).length;
      });
      return next;
    });
  }, []);

  const getSpeakerLabel = useCallback((id: string) => {
    return speakers.get(id)?.label || id;
  }, [speakers]);

  return { speakers, renameSpeaker, getSpeakerLabel, updateFromSegments };
}
```

**工数**: 45分

---

#### Step C-2: 話者一覧パネル

`TranscriptView` のヘッダーに折りたたみ可能な話者一覧を追加：

```tsx
{/* 話者一覧（話者識別有効時のみ） */}
{showSpeaker && speakers.size > 0 && (
  <div className="mb-3 rounded-md border border-gray-200 p-3">
    <h4 className="text-xs font-semibold text-gray-500 mb-2">話者一覧</h4>
    <div className="flex flex-wrap gap-2">
      {Array.from(speakers.values()).map(speaker => {
        const color = SPEAKER_COLORS[speaker.color % SPEAKER_COLORS.length];
        return (
          <div key={speaker.id} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${color.bg}`}>
            <span className={`font-bold ${color.label}`}>{speaker.label}</span>
            <span className="text-gray-400">({speaker.segmentCount}回)</span>
            <button
              onClick={() => {
                const name = prompt("話者名を入力", speaker.label);
                if (name) renameSpeaker(speaker.id, name);
              }}
              className="ml-1 text-gray-400 hover:text-gray-600"
            >
              ✏️
            </button>
          </div>
        );
      })}
    </div>
  </div>
)}
```

**工数**: 45分

---

#### Step C-3: speakerLabel をセグメントに反映

`page.tsx` で `useSpeakerManager` を使い、segments の speakerLabel を動的に設定：

```typescript
const { speakers, renameSpeaker, getSpeakerLabel, updateFromSegments } = useSpeakerManager();

// segments が変わったら speaker 情報を同期
useEffect(() => {
  if (enableSpeakerDiarization) {
    updateFromSegments(segments);
  }
}, [segments, enableSpeakerDiarization, updateFromSegments]);

// segments に speakerLabel を付与して TranscriptView に渡す
const labeledSegments = useMemo(() => {
  if (!enableSpeakerDiarization) return segments;
  return segments.map(seg => ({
    ...seg,
    speakerLabel: seg.speaker ? getSpeakerLabel(seg.speaker) : undefined,
  }));
}, [segments, enableSpeakerDiarization, getSpeakerLabel]);
```

**工数**: 30分

---

#### Step C-4: 保存時に話者情報を含める

`handleSave` で segments を保存用 `TranscriptSegment[]` に変換：

```typescript
transcript: {
  segments: segments.map((seg, i) => ({
    id: seg.id,
    speaker: seg.speaker ? (getSpeakerLabel(seg.speaker) || seg.speaker) : undefined,
    text: seg.text,
    startTime: seg.timestamp / 1000,
    endTime: seg.duration ? (seg.timestamp + seg.duration) / 1000 : duration,
  })),
  fullText: transcript,
},
```

**工数**: 15分

---

#### Step C-5: テスト・動作確認

**工数**: 15分

---

### Phase C 合計: 約3時間
### Phase C 完了で得られるもの:
- ✅ 話者のカスタム名設定（「Guest-1」→「田中さん」）
- ✅ 話者一覧パネルと発話回数表示
- ✅ LocalStorage による話者名永続化
- ✅ 保存時に話者情報を含む Transcript 生成

---

### ═══════════════════════════════════════
### Phase D: 統合・磨き上げ — 約3時間
### ═══════════════════════════════════════

#### Step D-1: 翻訳タブの scroll 改善

翻訳タブは `TranscriptView` を使わない（翻訳 API は全文一括のため）が、`scroll-smooth` 削除 + `rAF` + `overflow-anchor` を適用。

**工数**: 15分

---

#### Step D-2: 議事録生成に話者情報を含める

`summaryApi.generateSummary` に渡す transcript を話者付きフォーマットにする：

```typescript
// 話者識別有効時
const transcriptForSummary = enableSpeakerDiarization
  ? segments.map(s => `[${getSpeakerLabel(s.speaker || "不明")}] ${s.text}`).join("\n")
  : transcript;

const response = await summaryApi.generateSummary({
  transcript: transcriptForSummary,
  language: sourceLanguage,
});
```

これにより AI 議事録が「田中さんが提案し、鈴木部長が承認した」のような話者を含む議事録を生成できる。

**工数**: 15分

---

#### Step D-3: 録音詳細ページ（recording/page.tsx）の話者表示

保存済み Recording の表示で、`transcript.segments` に `speaker` が含まれている場合にバブル表示する。

**工数**: 30分

---

#### Step D-4: エッジケース対応

| ケース | 対応 |
|---|---|
| ConversationTranscriber 初期化失敗 | フォールバック: SpeechRecognizer に切り替え + エラー通知 |
| speakerId = "Unknown" の中間結果 | 「話者識別中...」のラベル表示 |
| pause → resume で speakerId リセット | UI にインフォメーション表示 |
| 1000+ segments のパフォーマンス | 将来的に仮想スクロール検討（Phase E） |

**工数**: 45分

---

#### Step D-5: 全体統合テスト・デプロイ・PR

| テストシナリオ | 確認事項 |
|---|---|
| 話者識別 OFF で録音 → 保存 → 翻訳 → コピー → 議事録 | 全後方互換 |
| 話者識別 ON で2人会話 → 保存 → 議事録 | 話者名付き保存・議事録 |
| 話者名カスタマイズ → 保存 | カスタム名で保存される |
| 30分録音 → スクロール動作 | フラッシュなし・スムーズ |
| pause → resume（話者識別 ON） | セグメント保持・警告表示 |

**工数**: 45分

---

### Phase D 合計: 約3時間

---

## 6. 変更ファイル一覧（全フェーズ合計）

### 変更するファイル

| ファイル | Phase | 変更内容 |
|---|---|---|
| `web/src/types/index.ts` | A | `LiveSegment` 型追加、`UserSettings` に `enableSpeakerDiarization` 追加 |
| `web/src/hooks/useSpeechRecognition.ts` | A+B | `segments: LiveSegment[]` を primary data に、ConversationTranscriber モード追加 |
| `web/src/app/page.tsx` | A+B+D | TranscriptView 導入、Phase 1 の autoFollow 関連コード削除、翻訳 scroll 改善 |
| `web/src/app/settings/page.tsx` | B | 話者識別トグル追加 |
| `web/src/contexts/AuthContext.tsx` | B | UserSettings デフォルト値に `enableSpeakerDiarization: false` 追加 |
| `web/src/app/recording/page.tsx` | D | 保存済み録音の話者バブル表示 |
| `web/src/services/summaryApi.ts` | D | 変更なし（呼び出し側で transcript フォーマットを変更） |

### 新規作成ファイル

| ファイル | Phase | 内容 |
|---|---|---|
| `web/src/components/TranscriptView.tsx` | A | セグメント分割レンダリング + 話者バブル + auto-scroll |
| `web/src/hooks/useSpeakerManager.ts` | C | 話者管理・ラベリング・永続化 |

### 変更不要ファイル（後方互換性）

| ファイル | 理由 |
|---|---|
| `web/src/services/recordingsApi.ts` | `Transcript` 型の構造は変更なし |
| `web/src/lib/export.ts` | `recording.transcript.fullText` で動作 |
| `web/src/hooks/useAudioRecorder.ts` | transcript 非依存 |
| `web/src/hooks/useRecordingStateMachine.ts` | FSM のみ |
| `api/**` | API 側は transcript 構造を透過的に保存するため変更不要 |

---

## 7. 全体ロードマップ

| Phase | 作業内容 | 見積り | 前提 |
|---|---|---|---|
| **A** | セグメント配列化 + TranscriptView + スムーズレンダリング | **2h** | なし |
| **B** | ConversationTranscriber 統合 + 設定 UI | **5h** | Phase A + Japan East 検証 |
| **C** | 話者管理 UI + ラベリング + 永続化 | **3h** | Phase B |
| **D** | 統合・磨き上げ（翻訳/議事録/詳細ページ） | **3h** | Phase C |
| **合計** | | **13h** | |

### 段階的デリバリー

| マイルストーン | Phase | Issue 完了 | 成果物 |
|---|---|---|---|
| **MS1**: スムーズ表示 | A 完了 | Issue #4 完全完了 | フラッシュ解消、差分 DOM 更新 |
| **MS2**: 話者識別 MVP | B 完了 | Issue #9 MVP | ConversationTranscriber 動作、カラーバブル |
| **MS3**: 話者管理 | C 完了 | Issue #9 フル | ラベリング、永続化 |
| **MS4**: 品質仕上げ | D 完了 | — | 議事録連携、エッジケース対応 |

**各マイルストーンごとにデプロイ + PR 可能** — 段階的にリリースできる。

---

## 8. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|---|---|---|---|
| Japan East で ConversationTranscriber が非対応 | Medium | High | East US へのフォールバック設定を準備。Phase A は影響なし |
| ConversationTranscriber の課金が想定以上 | Medium | Medium | 事前に料金確認。話者識別は設定でデフォルト OFF |
| pause → resume で speakerId リセット | High | Medium | UI で制限事項を明示。segments 自体は保持される |
| ConversationTranscriber + 翻訳の同時使用不可 | 確実 | Low | 現行の「認識後に翻訳 API 呼び出し」方式で対応済み |
| 1000+ segments のパフォーマンス劣化 | Low | Medium | memo + rAF で十分。将来的に仮想スクロール検討 |
| `segments.map(s => s.text).join(" ")` と旧 `transcript` の微差 | Low | High | テストで保存/翻訳/コピー/議事録の全パスを検証 |

---

## 9. 判定

### 🟢 GO

- Phase A（セグメント基盤）はブロッカーなし、即時着手可能
- Phase B は Japan East 検証が前提だが、Phase A と独立して準備可能
- 統合実装により**工数を20%削減**、リグレッションリスクを**半減**
- 段階的デリバリーにより各マイルストーンで独立してリリース可能
- 後方互換性により保存・翻訳・コピー・議事録・エクスポートの既存機能に影響なし
