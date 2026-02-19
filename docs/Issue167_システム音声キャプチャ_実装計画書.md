# Issue #167: システム音声キャプチャ対応 — 実装計画書

> **作成日**: 2026-02-19  
> **対象Issue**: [#167 システム音声キャプチャ対応（Teams/Zoom会議の相手音声録音）](https://github.com/hidetoshihonda/airecorder/issues/167)  
> **前提ドキュメント**: [Issue167_システム音声キャプチャ_分析レビュー.md](Issue167_システム音声キャプチャ_分析レビュー.md)  
> **見積り**: 22h（約3日）  
> **判定**: GO ✅

---

## 📋 実装概要

Teams/Zoom等のオンライン会議中にシステム音声（相手の声）をキャプチャし、録音・文字起こし・翻訳できるようにする。  
既存の `sharedStream` 設計を活用し、新規 `useAudioSource` フックで音声ソースを一元管理する。

---

## 🏗️ 変更ファイル一覧

### 新規作成

| ファイル | 説明 |
|---------|------|
| `web/src/lib/audioStreamAdapter.ts` | MediaStream → Azure SDK PushAudioInputStream 変換ユーティリティ |
| `web/src/hooks/useAudioSource.ts` | 音声ソース管理フック（mic/system/both） |

### 変更

| ファイル | 変更内容 |
|---------|---------|
| `web/src/hooks/useSpeechRecognition.ts` | `sharedStream` 渡し時に `fromStreamInput` を使用 |
| `web/src/hooks/useTranslationRecognizer.ts` | `sharedStream` オプション追加 + `fromStreamInput` 対応 |
| `web/src/app/page.tsx` | 音声ソースモードUI追加 + `useAudioSource` 統合 |
| `web/src/app/settings/page.tsx` | デフォルト音声ソース設定追加 |
| `web/src/types/index.ts` | `UserSettings` に `defaultAudioSource` 追加 |
| `api/src/models/recording.ts` | サーバー側 `UserSettings` に `defaultAudioSource` 追加 |
| `web/messages/ja.json` | 日本語メッセージ追加 |
| `web/messages/en.json` | 英語メッセージ追加 |
| `web/messages/es.json` | スペイン語メッセージ追加 |

---

## 📐 Step 1: `audioStreamAdapter.ts` — MediaStream → PushStream 変換

**ファイル**: `web/src/lib/audioStreamAdapter.ts`（新規）

### 目的

`MediaStream`（getUserMedia / getDisplayMedia が返す）を Azure Speech SDK の `PushAudioInputStream` に変換する。  
Azure SDK は **16kHz / 16bit / mono PCM** を要求するため、Web Audio API でリサンプリング＋フォーマット変換を行う。

### 実装コード

```typescript
"use client";

import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

/**
 * Float32Array (-1.0 ~ 1.0) を Int16Array (-32768 ~ 32767) に変換する
 */
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * MediaStream を Azure Speech SDK の PushAudioInputStream に変換する。
 *
 * AudioContext を sampleRate: 16000 で作成し、ScriptProcessorNode で
 * PCM データを PushAudioInputStream に書き込む。
 *
 * @returns pushStream, cleanup 関数（AudioContext のクリーンアップ用）
 */
export function createPushStreamFromMediaStream(
  mediaStream: MediaStream
): { pushStream: SpeechSDK.PushAudioInputStream; cleanup: () => void } {
  const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const pushStream = SpeechSDK.AudioInputStream.createPushStream(format);

  // AudioContext を 16kHz で作成（ブラウザが自動リサンプリング）
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // ScriptProcessorNode: バッファサイズ 4096, 入力1ch, 出力1ch
  const processor = audioContext.createScriptProcessorNode(4096, 1, 1);

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const float32Data = event.inputBuffer.getChannelData(0);
    const int16Data = float32ToInt16(float32Data);
    pushStream.write(int16Data.buffer);
  };

  source.connect(processor);
  // ScriptProcessorNode は destination に接続しないと動作しない
  processor.connect(audioContext.destination);

  const cleanup = () => {
    processor.disconnect();
    source.disconnect();
    audioContext.close().catch(() => {});
    pushStream.close();
  };

  return { pushStream, cleanup };
}
```

### 重要ポイント

- `AudioContext({ sampleRate: 16000 })` でブラウザに自動リサンプリングさせる
- `ScriptProcessorNode` は deprecated だが、全ブラウザで安定動作する。将来的に `AudioWorklet` に移行
- `cleanup()` で全リソースを確実に解放する

---

## 📐 Step 2: `useAudioSource` フック — 音声ソース管理

**ファイル**: `web/src/hooks/useAudioSource.ts`（新規）

### 目的

3つの音声ソースモード（mic / system / both）を統一的に管理し、  
単一の `MediaStream` を返却する。

### 実装コード

```typescript
"use client";

import { useCallback, useRef, useState } from "react";

export type AudioSourceMode = "mic" | "system" | "both";

interface UseAudioSourceReturn {
  /** 統合された MediaStream（録音・音声認識に使用） */
  stream: MediaStream | null;
  /** ストリーム取得中フラグ */
  isAcquiring: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** ストリーム取得（録音開始時に呼ぶ） */
  acquireStream: () => Promise<MediaStream>;
  /** ストリーム解放（録音停止時に呼ぶ） */
  releaseStream: () => void;
  /** getDisplayMedia API が利用可能かどうか */
  isSystemAudioSupported: boolean;
}

/**
 * 音声ソース管理フック
 *
 * - 'mic':    getUserMedia({ audio }) — マイクのみ
 * - 'system': getDisplayMedia({ audio, systemAudio }) — システム音声のみ
 * - 'both':   AudioContext で mic + system をミックス
 */
export function useAudioSource(mode: AudioSourceMode): UseAudioSourceReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // リソース管理用 Ref
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // getDisplayMedia の利用可否判定
  const isSystemAudioSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    "getDisplayMedia" in navigator.mediaDevices;

  /** マイクストリームを取得 */
  const getMicStream = useCallback(async (): Promise<MediaStream> => {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    });
  }, []);

  /** システム音声ストリームを取得 */
  const getSystemStream = useCallback(async (): Promise<MediaStream> => {
    // @ts-expect-error — systemAudio は Chrome/Edge 固有オプション
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: false, // 映像不要（音声のみキャプチャ）
      audio: true,
      // Chrome/Edge: システム音声を含める
      systemAudio: "include",
    });

    // video トラックは不要なので削除
    displayStream.getVideoTracks().forEach((track) => track.stop());

    // audio トラックがない場合（ユーザーが音声共有をチェックしなかった）
    if (displayStream.getAudioTracks().length === 0) {
      throw new Error(
        "システム音声が取得できませんでした。共有ダイアログで「システム音声を共有」にチェックしてください。"
      );
    }

    return displayStream;
  }, []);

  /** 2つの MediaStream を AudioContext でミックスする */
  const mixStreams = useCallback(
    (mic: MediaStream, system: MediaStream): MediaStream => {
      const ctx = new AudioContext();
      const destination = ctx.createMediaStreamDestination();

      const micSource = ctx.createMediaStreamSource(mic);
      const systemSource = ctx.createMediaStreamSource(system);

      micSource.connect(destination);
      systemSource.connect(destination);

      audioContextRef.current = ctx;
      destinationRef.current = destination;

      return destination.stream;
    },
    []
  );

  /** ストリーム取得 */
  const acquireStream = useCallback(async (): Promise<MediaStream> => {
    setIsAcquiring(true);
    setError(null);

    try {
      let resultStream: MediaStream;

      switch (mode) {
        case "mic": {
          const mic = await getMicStream();
          micStreamRef.current = mic;
          resultStream = mic;
          break;
        }

        case "system": {
          if (!isSystemAudioSupported) {
            throw new Error(
              "このブラウザはシステム音声キャプチャに対応していません。Chrome または Edge をお使いください。"
            );
          }
          const system = await getSystemStream();
          systemStreamRef.current = system;
          resultStream = system;
          break;
        }

        case "both": {
          if (!isSystemAudioSupported) {
            throw new Error(
              "このブラウザはシステム音声キャプチャに対応していません。Chrome または Edge をお使いください。"
            );
          }
          // マイクとシステム音声を並行取得
          const [mic, system] = await Promise.all([
            getMicStream(),
            getSystemStream(),
          ]);
          micStreamRef.current = mic;
          systemStreamRef.current = system;

          // AudioContext でミックス
          resultStream = mixStreams(mic, system);
          break;
        }
      }

      // track.onended ハンドリング（ユーザーが「共有を停止」した場合）
      resultStream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setError("音声共有が停止されました");
          releaseStream();
        };
      });

      setStream(resultStream);
      return resultStream;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "音声の取得に失敗しました";
      setError(message);
      throw err;
    } finally {
      setIsAcquiring(false);
    }
  }, [mode, getMicStream, getSystemStream, mixStreams, isSystemAudioSupported]);

  /** ストリーム解放 */
  const releaseStream = useCallback(() => {
    // AudioContext クリーンアップ
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      destinationRef.current = null;
    }

    // マイクストリーム停止
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    // システム音声ストリーム停止
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }

    setStream(null);
    setError(null);
  }, []);

  return {
    stream,
    isAcquiring,
    error,
    acquireStream,
    releaseStream,
    isSystemAudioSupported,
  };
}
```

### リソースライフサイクル

```
acquireStream()
  ├── getUserMedia → micStreamRef
  ├── getDisplayMedia → systemStreamRef
  └── AudioContext.mixStreams → audioContextRef + destinationRef
      └── stream (統合 MediaStream)

releaseStream()
  ├── audioContext.close()
  ├── micStream.getTracks().stop()
  └── systemStream.getTracks().stop()
```

---

## 📐 Step 3: `useSpeechRecognition` の `fromStreamInput` 対応

**ファイル**: `web/src/hooks/useSpeechRecognition.ts`（変更）

### 変更箇所

#### 3.1 インポート追加

```typescript
import { createPushStreamFromMediaStream } from "@/lib/audioStreamAdapter";
```

#### 3.2 `startConversationTranscriber` 内の AudioConfig 分岐（L61付近）

```typescript
// Before:
const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();

// After:
let audioConfig: SpeechSDK.AudioConfig;
let pushStreamCleanup: (() => void) | null = null;

if (sharedStream) {
  const { pushStream, cleanup } = createPushStreamFromMediaStream(sharedStream);
  audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
  pushStreamCleanup = cleanup;
} else {
  audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
}
```

#### 3.3 `startListening` 内の AudioConfig 分岐（L158付近）

同様のパターンで `fromStreamInput` 対応。

#### 3.4 クリーンアップ追加

`stopListening` と `pauseListening` で `pushStreamCleanup?.()` を呼ぶ。  
→ `pushStreamCleanupRef` を `useRef` で管理する。

### 注意: ConversationTranscriber との互換性

`ConversationTranscriber` が `fromStreamInput` を受け付けるかは **要検証**。  
受け付けない場合のフォールバック:

```typescript
if (enableSpeakerDiarization && sharedStream) {
  // ⚠️ ConversationTranscriber は fromStreamInput 未対応の可能性
  // → マイクモードを強制 or エラーメッセージ表示
  setError("話者識別モードではシステム音声キャプチャは使用できません。話者識別をOFFにするか、マイクモードに切り替えてください。");
  return;
}
```

---

## 📐 Step 4: `useTranslationRecognizer` の `sharedStream` 対応

**ファイル**: `web/src/hooks/useTranslationRecognizer.ts`（変更）

### 変更箇所

#### 4.1 Options インターフェースに `sharedStream` 追加

```typescript
interface UseTranslationRecognizerOptions {
  subscriptionKey: string;
  region: string;
  sourceLanguage: string;
  targetLanguage: string;
  phraseList?: string[];
  sharedStream?: MediaStream | null;  // ★ 追加
}
```

#### 4.2 `startListening` 内の AudioConfig 分岐（L115付近）

```typescript
// Before:
const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();

// After:
let audioConfig: SpeechSDK.AudioConfig;
let pushStreamCleanup: (() => void) | null = null;

if (sharedStream) {
  const { pushStream, cleanup } = createPushStreamFromMediaStream(sharedStream);
  audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
  pushStreamCleanup = cleanup;
  pushStreamCleanupRef.current = cleanup;
} else {
  audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
}
```

#### 4.3 クリーンアップ追加

`stopListening` で `pushStreamCleanupRef.current?.()` を呼ぶ。

---

## 📐 Step 5: `UserSettings` 型拡張

### 5.1 フロントエンド — `web/src/types/index.ts`

```typescript
export interface UserSettings {
  // ... 既存フィールド ...
  defaultAudioSource?: AudioSourceMode;  // ★ 追加 ('mic' | 'system' | 'both')
}
```

### 5.2 バックエンド — `api/src/models/recording.ts`

```typescript
export interface UserSettings {
  // ... 既存フィールド ...
  defaultAudioSource?: "mic" | "system" | "both";  // ★ 追加
}
```

### デフォルト値

- `defaultAudioSource` のデフォルトは `'mic'`（既存動作と完全互換）
- 未設定時のフォールバック: `settings.defaultAudioSource ?? 'mic'`

---

## 📐 Step 6: `page.tsx` — 音声ソースセレクター UI

**ファイル**: `web/src/app/page.tsx`（変更）

### 6.1 State 追加

```typescript
const [audioSourceMode, setAudioSourceMode] = useState<AudioSourceMode>(
  settings.defaultAudioSource ?? "mic"
);
```

### 6.2 `useAudioSource` フック統合

```typescript
import { useAudioSource, AudioSourceMode } from "@/hooks/useAudioSource";

const {
  stream: sharedStream,
  isAcquiring: isAcquiringAudio,
  error: audioSourceError,
  acquireStream,
  releaseStream,
  isSystemAudioSupported,
} = useAudioSource(audioSourceMode);
```

### 6.3 フック呼び出し変更

```typescript
// useSpeechRecognition に sharedStream を渡す
const { ... } = useSpeechRecognition({
  subscriptionKey: speechConfig.subscriptionKey,
  region: speechConfig.region,
  language: sourceLanguage,
  enableSpeakerDiarization,
  phraseList: settings.phraseList ?? [],
  sharedStream,  // ★ 追加
});

// useTranslationRecognizer に sharedStream を渡す
const { ... } = useTranslationRecognizer({
  subscriptionKey: speechConfig.subscriptionKey,
  region: speechConfig.region,
  sourceLanguage,
  targetLanguage,
  phraseList: settings.phraseList ?? [],
  sharedStream,  // ★ 追加
});

// useAudioRecorder に sharedStream を渡す
const { ... } = useAudioRecorder({
  audioQuality: settings.audioQuality,
  sharedStream,  // ★ 追加（既存の sharedStream 対応を活用）
});
```

### 6.4 `handleStartRecording` 変更

```typescript
const handleStartRecording = async () => {
  if (!requireAuth(t("startRecording"))) return;
  if (!canStart) return;

  dispatch({ type: "START" });
  // ... 既存のリセット処理 ...

  try {
    // ★ まずストリームを取得
    const audioStream = await acquireStream();

    // ストリーム取得後に音声認識・録音を開始
    startListening();
    await startAudioRecording(audioStream);  // sharedStream 経由で自動的に使用
    dispatch({ type: "START_SUCCESS" });
  } catch (err) {
    const message = err instanceof Error ? err.message : t("startRecordingFailed");
    dispatch({ type: "START_FAILURE", error: message });
    releaseStream();
  }
};
```

### 6.5 `handleStopRecording` 変更

```typescript
const handleStopRecording = () => {
  if (!canStop) return;
  dispatch({ type: "STOP" });
  stopListening();
  stopAudioRecording();
  releaseStream();  // ★ ストリーム解放追加
  dispatch({ type: "STOP_SUCCESS" });
};
```

### 6.6 UI — 音声ソースセレクター

録音ボタンの左側、言語セレクターの後に配置:

```tsx
{/* Audio Source Mode Selector */}
{isSystemAudioSupported && (
  <>
    <div className="h-6 w-px bg-gray-200" />
    <Select
      value={audioSourceMode}
      onValueChange={(v) => setAudioSourceMode(v as AudioSourceMode)}
    >
      <SelectTrigger className="h-8 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="mic">
          🎤 {t("audioSourceMic")}
        </SelectItem>
        <SelectItem value="system">
          🖥️ {t("audioSourceSystem")}
        </SelectItem>
        <SelectItem value="both">
          🎤+🖥️ {t("audioSourceBoth")}
        </SelectItem>
      </SelectContent>
    </Select>
  </>
)}
```

### 6.7 話者識別との排他制御

```typescript
// 話者識別 ON + システム音声モード → 警告表示
{enableSpeakerDiarization && audioSourceMode !== "mic" && (
  <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">
    ⚠️ {t("speakerDiarizationSystemAudioWarning")}
  </div>
)}
```

---

## 📐 Step 7: 設定画面のデフォルト音声ソース設定

**ファイル**: `web/src/app/settings/page.tsx`（変更）

音声設定カードに「デフォルト音声ソース」ドロップダウンを追加:

```tsx
{/* Default Audio Source */}
{isSystemAudioSupported && (
  <div className="flex items-center justify-between">
    <div>
      <label className="text-sm font-medium">{t("defaultAudioSource")}</label>
      <p className="text-xs text-gray-500">{t("defaultAudioSourceDescription")}</p>
    </div>
    <Select
      value={settings.defaultAudioSource ?? "mic"}
      onValueChange={(v) => updateSettings({ defaultAudioSource: v as AudioSourceMode })}
    >
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="mic">🎤 {t("audioSourceMic")}</SelectItem>
        <SelectItem value="system">🖥️ {t("audioSourceSystem")}</SelectItem>
        <SelectItem value="both">🎤+🖥️ {t("audioSourceBoth")}</SelectItem>
      </SelectContent>
    </Select>
  </div>
)}
```

---

## 📐 Step 8: 多言語対応（i18n メッセージ）

### `web/messages/ja.json` に追加

```json
{
  "HomePage": {
    "audioSourceMic": "マイクのみ",
    "audioSourceSystem": "システム音声",
    "audioSourceBoth": "マイク＋システム音声",
    "speakerDiarizationSystemAudioWarning": "話者識別はシステム音声モードでは使用できません",
    "systemAudioNotSupported": "このブラウザはシステム音声キャプチャに対応していません",
    "audioShareStopped": "音声共有が停止されました"
  },
  "Settings": {
    "defaultAudioSource": "デフォルト音声ソース",
    "defaultAudioSourceDescription": "録音開始時のデフォルト音声入力モード"
  }
}
```

### `web/messages/en.json` に追加

```json
{
  "HomePage": {
    "audioSourceMic": "Microphone only",
    "audioSourceSystem": "System audio",
    "audioSourceBoth": "Mic + System audio",
    "speakerDiarizationSystemAudioWarning": "Speaker diarization is not available with system audio mode",
    "systemAudioNotSupported": "System audio capture is not supported in this browser",
    "audioShareStopped": "Audio sharing was stopped"
  },
  "Settings": {
    "defaultAudioSource": "Default audio source",
    "defaultAudioSourceDescription": "Default audio input mode when starting recording"
  }
}
```

### `web/messages/es.json` に追加

```json
{
  "HomePage": {
    "audioSourceMic": "Solo micrófono",
    "audioSourceSystem": "Audio del sistema",
    "audioSourceBoth": "Mic + Audio del sistema",
    "speakerDiarizationSystemAudioWarning": "La identificación del hablante no está disponible con el modo de audio del sistema",
    "systemAudioNotSupported": "La captura de audio del sistema no es compatible con este navegador",
    "audioShareStopped": "Se detuvo el uso compartido de audio"
  },
  "Settings": {
    "defaultAudioSource": "Fuente de audio predeterminada",
    "defaultAudioSourceDescription": "Modo de entrada de audio predeterminado al iniciar la grabación"
  }
}
```

---

## 📐 Step 9: エラーハンドリング強化

### 9.1 `page.tsx` — エラー配列に audioSourceError を追加

```typescript
const errors = [
  speechError,
  translationError,
  ttsError,
  audioError,
  fsmError,
  correctionError,
  audioSourceError,  // ★ 追加
].filter(Boolean) as string[];
```

### 9.2 `useAudioSource` — 共有停止時のコールバック

```typescript
// page.tsx で onShareStopped コールバックを使用
const handleAudioShareStopped = useCallback(() => {
  // 録音を停止
  handleStopRecording();
}, [handleStopRecording]);

// useAudioSource に渡す（onEnded コールバック）
```

---

## 📐 Step 10: テスト実施

### 手動テストマトリクス

| # | テストケース | 環境 | 手順 | 期待結果 |
|---|------------|------|------|---------|
| 1 | マイクモードで録音 | Chrome | 「マイクのみ」を選択 → 録音開始 → 停止 | 既存動作と同一。回帰なし |
| 2 | システム音声で録音 | Chrome | 「システム音声」を選択 → 録音開始 → 共有ダイアログでタブ選択 → 停止 | システム音声が文字起こしされる |
| 3 | 両方で録音 | Chrome | 「マイク+システム音声」→ 録音開始 → 停止 | 両方の音声が文字起こしされる |
| 4 | 共有停止 | Chrome | 録音中にブラウザの「共有を停止」をクリック | 録音が停止、エラーメッセージ表示 |
| 5 | 非対応ブラウザ | Firefox | セレクターが表示されないことを確認 | 「システム音声」選択肢が非表示 |
| 6 | 話者識別+システム音声 | Chrome | 話者識別ON → システム音声を選択 | 警告メッセージ表示 |
| 7 | 翻訳+システム音声 | Chrome | リアルタイム翻訳ON → システム音声で録音 | 翻訳が正常動作 |
| 8 | Safari タブ音声 | Safari | 「システム音声」→ タブ選択 | タブ音声のみキャプチャ |
| 9 | iOS | Safari/iOS | セレクターが表示されないことを確認 | 非表示 |
| 10 | 設定の永続化 | Chrome | 設定画面でデフォルト音声ソースを変更 → ページ再読み込み | 設定が保持される |

---

## ⚠️ 既知の制約・注意事項

| # | 制約 | 対処 |
|---|------|------|
| 1 | `ScriptProcessorNode` は deprecated | 現状は安定動作。将来的に `AudioWorklet` に移行 |
| 2 | `ConversationTranscriber` (話者識別) と `fromStreamInput` の互換性未検証 | 話者識別ON時はマイクモードに制限 or フォールバック |
| 3 | Chrome の `getDisplayMedia` は必ずユーザー操作が必要（API 呼び出しだけでは不可） | 録音ボタンクリックハンドラ内で呼ぶ |
| 4 | `systemAudio: 'include'` は Chrome/Edge 固有 | TypeScript の型定義にないため `@ts-expect-error` が必要 |
| 5 | `video: false` でも Chrome はタブ共有 UI を表示する場合がある | ユーザーが映像共有を選んでも video トラックは即座に stop() |

---

## 🔄 フォールバック戦略

```
acquireStream() 失敗時のフォールバック:
  ├── mode: 'system' → エラー表示「システム音声を取得できませんでした」
  │                     → 自動的に 'mic' にフォールバックしない（ユーザー判断）
  ├── mode: 'both'   → Promise.all の片方が失敗
  │                     → 取得できた方のみで続行 or エラー表示
  └── mode: 'mic'    → 既存の getUserMedia エラーハンドリングと同一

録音中の共有停止:
  └── track.onended → handleStopRecording() 呼び出し + エラーメッセージ表示
```

---

## 📊 実装スケジュール

| Day | Step | 作業内容 |
|-----|------|---------|
| Day 1 AM | Step 1-2 | `audioStreamAdapter.ts` + `useAudioSource.ts` 新規作成 |
| Day 1 PM | Step 3-4 | `useSpeechRecognition` + `useTranslationRecognizer` の `fromStreamInput` 対応 |
| Day 2 AM | Step 5-6 | 型定義 + `page.tsx` UI 統合 |
| Day 2 PM | Step 7-8 | 設定画面 + i18n |
| Day 3 AM | Step 9 | エラーハンドリング強化 |
| Day 3 PM | Step 10 | 手動テスト（Chrome/Edge/Safari/Firefox） |

---

## 🚀 デプロイ手順

1. ブランチ `feat/system-audio-capture` を作成
2. Step 1〜9 を実装
3. ESLint / TypeScript コンパイルエラーを解消
4. PR を作成（`main` ← `feat/system-audio-capture`）
5. CI 通過確認
6. マージ＋自動デプロイ

---
