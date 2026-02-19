# Issue #167: システム音声キャプチャ対応 — 分析レビュー

> **分析日**: 2026-02-19  
> **対象Issue**: [#167 システム音声キャプチャ対応（Teams/Zoom会議の相手音声録音）](https://github.com/hidetoshihonda/airecorder/issues/167)  
> **レビュアー**: ReviewAAgent  

---

## 1. エグゼクティブサマリー

- **問題の本質**: 現在のアプリは `getUserMedia({ audio })` によるマイク入力のみ対応しており、Teams/Zoom等のオンライン会議で相手の音声（システム音声）をキャプチャできない。これによりオンライン会議の文字起こし・翻訳が **自分の発言のみ** に限定される。
- **影響範囲**: オンライン会議ユースケースのユーザー全体（推定50〜70%のユースケース）。デスクトップChrome/Edge環境での対応が可能。
- **修正の緊急度**: **P2（中）** — 既存機能は正常に動作しているが、主要ユースケースの一つをカバーできていない。

---

## 2. アーキテクチャ概観

### 2.1 現在の音声パイプライン

```
┌─────────────────────────────────────────────────────────────┐
│                     page.tsx (HomePage)                       │
│                                                               │
│  handleStartRecording()                                       │
│   ├── startListening()  ──┐                                   │
│   │                       ├── useSpeechRecognition             │
│   │   translationMode     │   └── AudioConfig                 │
│   │   ├── "api" ──────────┤       .fromDefaultMicrophoneInput()│
│   │   └── "sdk" ──────────┤                                   │
│   │                       └── useTranslationRecognizer         │
│   │                           └── AudioConfig                 │
│   │                               .fromDefaultMicrophoneInput()│
│   │                                                           │
│   └── startAudioRecording() ── useAudioRecorder               │
│                                └── getUserMedia({ audio })     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 提案アーキテクチャ（Issue #167）

```
┌───────────────────────────────────────────────────────────────────┐
│                      page.tsx (HomePage)                           │
│                                                                     │
│  handleStartRecording()                                             │
│   │                                                                 │
│   ├── useAudioSource(mode) ─── ★ 新規フック                        │
│   │   ├── 'mic'    → getUserMedia({ audio })                       │
│   │   ├── 'system' → getDisplayMedia({ audio, systemAudio })       │
│   │   └── 'both'   → AudioContext mixing (mic + system)            │
│   │       返却: sharedStream: MediaStream                           │
│   │                                                                 │
│   ├── useSpeechRecognition({ sharedStream })                        │
│   │   └── AudioConfig.fromStreamInput(pushStream)  ← ★ 変更       │
│   │                                                                 │
│   ├── useTranslationRecognizer({ sharedStream })   ← ★ 変更       │
│   │   └── AudioConfig.fromStreamInput(pushStream)                   │
│   │                                                                 │
│   └── useAudioRecorder({ sharedStream })                            │
│       └── MediaRecorder(sharedStream) ← 既存の sharedStream 対応   │
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 データフロー図

```
[マイク] ──getUserMedia──┐
                          ├──→ AudioContext ──→ MediaStreamDestination
[システム音声]            │                     └── sharedStream
  ──getDisplayMedia──────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
             useAudioRecorder  useSpeech     useTranslation
             (MediaRecorder)   Recognition   Recognizer
                    │         (PushStream)   (PushStream)
                    ▼             ▼             ▼
               audio Blob     transcript   translated text
```

### 2.4 状態管理の構造

| State 変数 | 管理元 | 説明 |
|-----------|--------|------|
| `recordingState` | `useRecordingStateMachine` | FSM（idle→starting→recording→pausing→paused→...） |
| `isRecording`, `isPaused` | `useAudioRecorder` | 録音状態 |
| `isListening`, `isPaused` | `useSpeechRecognition` / `useTranslationRecognizer` | 音声認識状態 |
| `audioSourceMode` | ★新規（page.tsx state） | `'mic'` / `'system'` / `'both'` |
| `sharedStream` | ★新規（`useAudioSource`） | 共有 MediaStream |

---

## 3. 重大バグ分析 🔴

現時点で Issue #167 はバグ報告ではなく機能追加要望のため、「既存バグ」は該当なし。  
ただし、実装時に **高確率で発生するバグパターン** を予防的に列挙する。

### BUG-RISK-1: Azure Speech SDK の `fromStreamInput` 変換の PCM フォーマット不一致 [Critical]

**場所**: 新規 `useAudioSource` → `useSpeechRecognition` 間  
**問題**: Azure Speech SDK の `PushAudioInputStream` は **16-bit / 16kHz / mono PCM** を要求する。`getDisplayMedia` や `getUserMedia` が返す `MediaStream` は任意のサンプルレート（48kHz等）を持つ。`AudioContext` の `ScriptProcessorNode` / `AudioWorklet` で正しくリサンプリングしないと認識精度が激減する。  
**影響**: 音声認識が全く動かない、または認識精度が著しく低下する  
**根本原因**: Web Audio API の `MediaStream` ↔ Azure Speech SDK の `PushAudioInputStream` 間のフォーマット変換が必要  
**修正方針**: `AudioContext.sampleRate` を確認し、`OfflineAudioContext` でリサンプリングするか、`AudioWorklet` 内で16kHz/16bit/monoに変換してから `pushStream.write()` する

### BUG-RISK-2: `getDisplayMedia` のユーザー操作で「共有を停止」された時のハンドリング [High]

**場所**: 新規 `useAudioSource`  
**問題**: ユーザーがブラウザの「共有を停止」ボタンをクリックすると、`MediaStreamTrack` の `ended` イベントが発火する。これを検知して録音を適切に停止/フォールバックしないと、無音のまま録音が続く  
**影響**: ユーザーに気づかれないまま無音録音が継続し、リソース浪費＋無意味なデータが保存される  
**修正方針**: `track.onended` ハンドラを設定し、共有停止時に `handleStopRecording()` を呼ぶか、マイクモードにフォールバックする

### BUG-RISK-3: `AudioContext` の `state` が `suspended` のまま開始 [Medium]

**場所**: 新規 `useAudioSource`（'both' モード）  
**問題**: Chrome ではユーザージェスチャーなしで `AudioContext` を作成すると `suspended` 状態で始まる。`context.resume()` を呼ばないとミキシングが無音になる  
**影響**: 'both' モードで一切音声が取得できない  
**修正方針**: `AudioContext` 作成直後に `await context.resume()` を呼ぶ。ユーザークリック（録音ボタン）のイベントハンドラ内で `AudioContext` を作成する

---

## 4. 設計上の問題 🟡

### DESIGN-1: 既存の `sharedStream` オプションは未使用 [Medium]

**場所**: [useAudioRecorder.ts](web/src/hooks/useAudioRecorder.ts#L13) L13-14, [useSpeechRecognition.ts](web/src/hooks/useSpeechRecognition.ts#L15) L15  
**問題**: `UseAudioRecorderOptions.sharedStream` と `UseSpeechRecognitionOptions.sharedStream` が型定義されているが、**実際の使用箇所では一切渡されていない**。`useAudioRecorder` は `sharedStream` を `MediaRecorder` に渡す機構を持つが、`useSpeechRecognition` は `sharedStream` を受け取っても **`fromDefaultMicrophoneInput()` をハードコードしており無視している**。  
**影響**: `sharedStream` を渡しても Azure SDK の音声入力は変わらない  
**修正方針**: `sharedStream` が渡された場合は `AudioConfig.fromStreamInput()` を使うように分岐する。これが Issue #167 の核心的な変更点。

### DESIGN-2: `useTranslationRecognizer` に `sharedStream` オプションが存在しない [Medium]

**場所**: [useTranslationRecognizer.ts](web/src/hooks/useTranslationRecognizer.ts#L9) L9  
**問題**: `UseTranslationRecognizerOptions` インターフェースに `sharedStream` プロパティがない。SDK モードでシステム音声を使う場合にも `fromDefaultMicrophoneInput()` がハードコードされている。  
**修正方針**: `useSpeechRecognition` と同じパターンで `sharedStream` オプションを追加し、`fromStreamInput()` 対応する

### DESIGN-3: 3つの音声認識フックが独立して `AudioConfig` を作成している [Medium]

**場所**: `useSpeechRecognition.ts` L61,L158、`useTranslationRecognizer.ts` L115  
**問題**: `fromDefaultMicrophoneInput()` が3箇所に分散。システム音声対応時に同じ変更を3箇所に適用する必要がある。  
**修正方針**: `useAudioSource` フックに音声ソース管理を一元化し、各認識フックは `sharedStream` 経由でのみ音声を受け取る

### DESIGN-4: `page.tsx` が1752行と巨大 [Low]

**場所**: [page.tsx](web/src/app/page.tsx)  
**問題**: 録音 UI、結果表示、要約生成、保存ロジック等すべてが1ファイルに詰め込まれている。システム音声モード切替UIを追加するとさらに肥大化する。  
**修正方針**: 今回のスコープでは UI 追加を最小限に留め、ロジックは新規フック (`useAudioSource`) に分離する

### ✅ Good: `useAudioRecorder` の `sharedStream` 対応は既に実装済み

**場所**: [useAudioRecorder.ts](web/src/hooks/useAudioRecorder.ts#L79-L95) L79-95  
`sharedStream` が渡された場合は `getUserMedia` を呼ばず、渡されたストリームを `MediaRecorder` に直接使用する設計が既にある。`ownsStreamRef` フラグでストリームのライフサイクル管理（自分で取得したストリームのみ停止）も正しく実装されている。**この設計は活用できる**。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue間依存関係

```
Issue #167 (システム音声キャプチャ)
  ├── 独立 ── 他Issueへの依存なし
  │
  ├── 将来的影響 ──→ Issue #97 (ノイズ除去)
  │   └── システム音声 + マイク混合時のエコーキャンセル/ノイズ処理が重要に
  │
  └── 将来的影響 ──→ Issue #82 (自動言語検出)
      └── 相手音声の言語がマイク音声と異なる場合の対応
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `useAudioSource` (新規) | `getDisplayMedia` API | Firefox/Safari/iOS で非対応・制限あり | プラットフォーム検出で非対応時はUIを非表示 |
| `useSpeechRecognition` | Azure Speech SDK `fromStreamInput` | PCMフォーマット変換が必要 | AudioWorklet でリサンプリング |
| `useTranslationRecognizer` | 同上 | 同上 | 同上 |
| `useAudioRecorder` | `MediaRecorder` API | `sharedStream` 対応は既存 | リスク低 |
| `AudioContext` (mixing) | Web Audio API | `suspended` 状態問題 | ユーザーアクション内で作成 |
| `page.tsx` | 全フックの統合 | 複雑度増加 | `useAudioSource` に分離 |

### 5.3 他 Issue/機能との相互作用

| Issue/機能 | 相互作用 | 詳細 |
|-----------|---------|------|
| **話者識別 (`enableSpeakerDiarization`)** | ⚠️ 注意必要 | `ConversationTranscriber` は `fromDefaultMicrophoneInput()` のみ対応の可能性あり。`fromStreamInput` との互換性要検証 |
| **Issue #126 リアルタイムAI補正** | ✅ 影響なし | セグメント単位の補正なのでストリームソースに依存しない |
| **Issue #35 TranslationRecognizer** | ⚠️ 変更必要 | `fromDefaultMicrophoneInput` → `fromStreamInput` への切り替えが必要 |
| **PWA (Issue #165)** | ✅ 影響なし | `getDisplayMedia` はPWAモードでも動作する |
| **フレーズリスト (Issue #34)** | ✅ 影響なし | `PhraseListGrammar` はストリームソースに依存しない |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク | 備考 |
|------|---------|--------|------|
| Desktop Chrome 94+ | ✅ 対応可能 | 低 | `systemAudio: 'include'` オプション対応 |
| Desktop Edge 94+ | ✅ 対応可能 | 低 | Chromium ベースのため Chrome と同等 |
| Desktop Firefox | ❌ 非対応 | — | `getDisplayMedia` で `systemAudio` オプション未サポート |
| Desktop Safari (macOS 13+) | ⚠️ 限定的 | 中 | タブ音声のみ。システム全体の音声はキャプチャ不可 |
| iOS (全ブラウザ) | ❌ 不可能 | — | Apple OS レベルでシステム音声キャプチャをブロック |
| Android Chrome | ⚠️ 不安定 | 高 | OS バージョン・端末依存。API 対応が不均一 |
| PWA (Standalone) | ✅ 対応可能 | 低 | Chrome/Edge ベースなら動作 |

### プラットフォーム検出に必要な API チェック

```typescript
// getDisplayMedia の利用可否
const canCaptureDisplay = 'getDisplayMedia' in navigator.mediaDevices;

// systemAudio の利用可否（Chrome/Edge のみ）
// ※ API レベルでの事前検出は不可。getUserMedia と異なり capabilities で確認できない
// → UI で「対応ブラウザでのみ表示」方式を採用
```

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）— 基盤実装

**目的**: `useAudioSource` フック新規作成と、既存フックの `fromStreamInput` 対応

#### 7.1.1 `useAudioSource` フック新規作成

**新規ファイル**: `web/src/hooks/useAudioSource.ts`

```typescript
// useAudioSource.ts — 音声ソース管理フック
export type AudioSourceMode = 'mic' | 'system' | 'both';

interface UseAudioSourceOptions {
  mode: AudioSourceMode;
}

interface UseAudioSourceReturn {
  stream: MediaStream | null;
  isAcquiring: boolean;
  error: string | null;
  acquireStream: () => Promise<MediaStream>;
  releaseStream: () => void;
  isSystemAudioSupported: boolean;
}

export function useAudioSource(options: UseAudioSourceOptions): UseAudioSourceReturn {
  // mode === 'mic':    getUserMedia({ audio })
  // mode === 'system': getDisplayMedia({ audio: true, video: false, systemAudio: 'include' })
  // mode === 'both':   両方取得 → AudioContext で mix → MediaStreamDestination
  //
  // 返却: 統一された MediaStream
}
```

#### 7.1.2 `useSpeechRecognition` の `fromStreamInput` 対応

**変更ファイル**: `web/src/hooks/useSpeechRecognition.ts`

現在の `fromDefaultMicrophoneInput()` を、`sharedStream` が渡された場合に `fromStreamInput()` に切り替える。

**核心的な変更**:
```typescript
// Before:
const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();

// After:
let audioConfig: SpeechSDK.AudioConfig;
if (sharedStream) {
  const pushStream = createPushStreamFromMediaStream(sharedStream);
  audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
} else {
  audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
}
```

#### 7.1.3 `MediaStream → PushAudioInputStream` 変換ユーティリティ

**新規ファイル**: `web/src/lib/audioStreamAdapter.ts`

```typescript
// MediaStream を Azure SDK の PushAudioInputStream に変換する
// AudioContext + ScriptProcessorNode (or AudioWorklet) で
// 48kHz → 16kHz リサンプリング + Float32 → Int16 変換
export function createPushStreamFromMediaStream(
  mediaStream: MediaStream
): SpeechSDK.PushAudioInputStream {
  const pushStream = SpeechSDK.AudioInputStream.createPushStream(
    SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
  );
  
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessorNode(4096, 1, 1);
  
  processor.onaudioprocess = (event) => {
    const float32Data = event.inputBuffer.getChannelData(0);
    const int16Data = float32ToInt16(float32Data);
    pushStream.write(int16Data.buffer);
  };
  
  source.connect(processor);
  processor.connect(audioContext.destination);
  
  return pushStream;
}
```

#### 7.1.4 `useTranslationRecognizer` の `sharedStream` 対応

**変更ファイル**: `web/src/hooks/useTranslationRecognizer.ts`

`useSpeechRecognition` と同じパターンで `sharedStream` オプション追加 + `fromStreamInput` 対応。

### Phase 2: 設計改善（P1）— UI とユーザー体験

#### 7.2.1 録音画面に「音声ソース」セレクター追加

**変更ファイル**: `web/src/app/page.tsx`

録音ボタンの近くに音声ソースモード切替UIを追加:
- デフォルト: `🎤 マイク` 
- オプション: `🖥️ システム音声` / `🎤+🖥️ 両方`
- 非対応環境では選択肢を非表示

#### 7.2.2 設定画面に永続化オプション追加

**変更ファイル**: `web/src/app/settings/page.tsx`, `web/src/types/index.ts`, `api/src/models/recording.ts`

`UserSettings` に `defaultAudioSource: AudioSourceMode` を追加。

#### 7.2.3 プラットフォーム非対応時のガイダンスUI

非対応環境でシステム音声モードが選択できない場合、対応ブラウザへの誘導メッセージを表示。

### Phase 3: 堅牢性強化（P2）

#### 7.3.1 `getDisplayMedia` の共有停止ハンドリング

`track.onended` でユーザーが「共有を停止」した場合の適切なフォールバック。

#### 7.3.2 エコーキャンセレーション

'both' モードでシステム音声とマイク音声を混合する際、自分の声がシステム音声側にも入る可能性（エコー）への対処。
→ `getUserMedia` の `echoCancellation: true` で基本対応。

#### 7.3.3 AudioWorklet への移行

`ScriptProcessorNode` は非推奨（deprecated）。将来的に `AudioWorkletNode` に移行して、メインスレッドのブロッキングを防止。

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|------------|------|---------|
| mic モードで stream 取得 | `mode: 'mic'` | `getUserMedia` が呼ばれる |
| system モードで stream 取得 | `mode: 'system'` | `getDisplayMedia` が呼ばれる |
| both モードで stream 取得 | `mode: 'both'` | 両方呼ばれ、`AudioContext` でミックスされる |
| system モードで非対応環境 | `getDisplayMedia` 未サポート | エラーメッセージ表示、`isSystemAudioSupported: false` |
| 共有停止イベント | `track.onended` 発火 | 録音停止 or マイクモードにフォールバック |
| stream 解放 | `releaseStream()` 呼び出し | 全トラック停止、AudioContext close |

### 8.2 PCM 変換テスト（Unit）

| テストケース | 入力 | 期待結果 |
|------------|------|---------|
| Float32 → Int16 変換 | `[0.0, 0.5, -0.5, 1.0, -1.0]` | `[0, 16383, -16384, 32767, -32768]` |
| リサンプリング | 48kHz AudioBuffer | 16kHz PCM データ |

### 8.3 統合テスト

| シナリオ | モック | 期待結果 |
|---------|--------|---------|
| マイクのみで録音→停止→再生 | `getUserMedia` モック | 既存動作と同一 |
| システム音声で録音→文字起こし | `getDisplayMedia` + Azure SDK モック | 文字起こしテキストが表示される |
| 両方で録音→翻訳 | 両 API モック | 翻訳テキストが表示される |
| 録音中に共有停止 | `track.onended` 発火 | 適切にフォールバック |

### 8.4 手動テスト — ブラウザ別

| ブラウザ | テスト項目 |
|---------|----------|
| Chrome (Windows) | 全3モード、システム音声チェックボックス確認 |
| Edge (Windows) | 全3モード、Chrome と同等の動作確認 |
| Chrome (macOS) | 全3モード |
| Safari (macOS) | タブ音声のみ対応を確認、システム音声モードで適切なエラー |
| Firefox | システム音声モードが非表示であることを確認 |
| Chrome (Android) | 不安定動作の確認、適切なエラーハンドリング |
| Safari (iOS) | システム音声モードが非表示であることを確認 |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 | 変更ファイル |
|------|---------|--------|---------|-------------|
| 1 | `audioStreamAdapter.ts` 新規作成（MediaStream→PushStream変換） | 3h | 新規ファイル | `web/src/lib/audioStreamAdapter.ts` |
| 2 | `useAudioSource.ts` フック新規作成 | 4h | 新規ファイル | `web/src/hooks/useAudioSource.ts` |
| 3 | `useSpeechRecognition.ts` の `fromStreamInput` 対応 | 2h | 音声認識全体 | `web/src/hooks/useSpeechRecognition.ts` |
| 4 | `useTranslationRecognizer.ts` の `sharedStream` 対応 | 2h | SDK翻訳モード | `web/src/hooks/useTranslationRecognizer.ts` |
| 5 | `UserSettings` 型に `defaultAudioSource` 追加 | 1h | 型定義 | `web/src/types/index.ts`, `api/src/models/recording.ts` |
| 6 | `page.tsx` に音声ソースセレクター UI 追加 | 3h | 録音画面 | `web/src/app/page.tsx` |
| 7 | 設定画面にデフォルト音声ソース設定追加 | 1h | 設定画面 | `web/src/app/settings/page.tsx` |
| 8 | 多言語対応（i18n メッセージ追加） | 1h | 翻訳ファイル | `web/messages/ja.json`, `en.json`, `es.json` |
| 9 | `track.onended` ハンドリング＋エラー処理 | 2h | `useAudioSource` | `web/src/hooks/useAudioSource.ts` |
| 10 | 手動テスト（Chrome/Edge/Safari/Firefox） | 3h | — | — |
| **合計** | | **22h（約3日）** | | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Azure SDK の `fromStreamInput` でリアルタイム連続認識が不安定 | 中 | Critical | `fromDefaultMicrophoneInput` へのフォールバック機構を実装 |
| PCM リサンプリングによる音声認識精度低下 | 中 | High | 16kHz/16bit/mono を厳密に遵守。テストで品質確認 |
| `ScriptProcessorNode` のメインスレッドブロック | 低 | Medium | 将来的に AudioWorklet に移行。現状では 4096 バッファで十分軽量 |
| `getDisplayMedia` のブラウザ UI が分かりにくい | 低 | Medium | ユーザーガイド（ヘルプテキスト）を UI に追加 |
| `ConversationTranscriber` (話者識別) と `fromStreamInput` の互換性 | 高 | High | 話者識別ON時は `fromDefaultMicrophoneInput` にフォールバック or 検証して対応 |
| 'both' モードでのエコー問題 | 中 | Medium | `echoCancellation: true` + ユーザーへの注意喚起 |

---

## 11. 結論

### 最大の問題点

1. **Azure Speech SDK の `fromDefaultMicrophoneInput()` がハードコード** — 3箇所で独立して呼ばれており、外部ストリームを注入する設計になっていない。`useSpeechRecognition` の `sharedStream` オプションは型定義のみで実質未使用。
2. **`MediaStream → PushAudioInputStream` のフォーマット変換** — Web Audio API と Azure SDK 間のフォーマットギャップ（Float32/48kHz vs Int16/16kHz）を埋める変換レイヤーが必要。
3. **プラットフォーム制限が大きい** — iOS/Firefox では完全に非対応。対応環境でもブラウザの権限ダイアログが必要。

### 推奨する修正順序

1. **Step 1-2**: `audioStreamAdapter.ts` + `useAudioSource.ts` 新規作成（基盤）
2. **Step 3-4**: 既存フックの `fromStreamInput` 対応（核心）
3. **Step 5-8**: UI + 設定 + i18n（表面）
4. **Step 9-10**: エラーハンドリング + テスト（品質）

### 他 Issue への影響サマリー

- **Issue #97（ノイズ除去）**: 'both' モードのエコー問題と関連するが、直接ブロックしない
- **Issue #82（自動言語検出）**: 相手音声の言語検出に将来的に影響
- 他の進行中 Issue への直接的影響なし

### 判定: `GO` ✅

実装リスクは管理可能であり、既存の `sharedStream` 設計を活用できる。段階的に実装し、マイクモードへのフォールバックを確保すれば安全に進行可能。

---
