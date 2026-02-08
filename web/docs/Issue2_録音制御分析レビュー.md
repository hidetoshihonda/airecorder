# Issue #2: 録音の再生停止再開ボタン — 超詳細分析レビュー

> **レビュアー**: Staff+ Engineer / PM / Architect 観点  
> **対象ブランチ**: `feature/fix-recording-controls`（`main` から作成予定）  
> **優先度**: P0 (Critical)  
> **ラベル**: bug  

---

## 1. エグゼクティブサマリー

現在の録音制御は **2つの独立した非同期システム**（Speech SDK + MediaRecorder）を **同期的なUI操作で制御する設計** になっており、根本的な状態不整合リスクを抱えている。  
本レビューでは **7つの重大バグ、5つの設計上の問題、3つの依存関係リスク** を特定した。

---

## 2. アーキテクチャ概観

### 2.1 現在のコンポーネント依存関係

```
page.tsx (Orchestrator)
├── useSpeechRecognition.ts   ← Azure Speech SDK (認識)
│   └── SpeechRecognizer       ← WebSocket接続 + マイクストリーム
├── useAudioRecorder.ts       ← MediaRecorder API (録音保存)
│   └── MediaRecorder          ← getUserMedia() マイクストリーム
├── useTranslation.ts         ← Azure Translator REST API
├── useTextToSpeech.ts        ← Azure Speech SDK (読み上げ)
├── useAuthGate.ts            ← 認証ゲート (Issue #7)
└── RecordingContext.tsx      ← ★ 使われていない（後述）
```

### 2.2 データフロー

```
マイク入力 ─┬─→ Speech SDK (WebSocket) ──→ transcript/interimTranscript (state)
            │                                    ↓
            │                              useTranslation → translatedText (state)
            │
            └─→ MediaRecorder (Blob) ──→ audioBlob (state)
                                              ↓
                                         Blob Storage (保存時)
```

**致命的設計問題**: 2つの独立した MediaStream が同時にマイクを取得する。

---

## 3. 重大バグ分析

### 🔴 BUG-1: デュアル MediaStream によるリソースリーク

**場所**: `page.tsx` L169-172 (`handleStartRecording`)

```typescript
startListening();           // Speech SDK: AudioConfig.fromDefaultMicrophoneInput()
await startAudioRecording(); // MediaRecorder: navigator.mediaDevices.getUserMedia()
```

**問題**:
- `useSpeechRecognition` と `useAudioRecorder` が **別々に** `getUserMedia()` を呼ぶ
- Speech SDK の `AudioConfig.fromDefaultMicrophoneInput()` は内部で独自の MediaStream を作成
- ブラウザによっては **2つの同時マイクアクセス** が競合/拒否される
- Stop 時に Speech SDK 側の MediaStream は SDK 内部管理 → **手動で止められない**

**影響**: マイクアイコンが残り続ける、ストリーム解放漏れ、iOS Safari で完全に動作しない

**修正方針**: 単一の MediaStream を取得し、両方に共有する

---

### 🔴 BUG-2: Pause が Speech SDK を完全停止させる

**場所**: `useSpeechRecognition.ts` L180-191 (`pauseListening`)

```typescript
const pauseListening = useCallback(() => {
    if (recognizerRef.current && isListening && !isPaused) {
      pausedTranscriptRef.current = transcript;
      recognizerRef.current.stopContinuousRecognitionAsync(  // ← 完全停止！
        () => {
          setIsPaused(true);
          setInterimTranscript("");
        },
        ...
      );
    }
  }, [isListening, isPaused, transcript]);
```

**問題**:
- 「一時停止」で `stopContinuousRecognitionAsync()` を呼んでいるが、これは **セッション終了** 操作
- Azure Speech SDK には **Pause 機能がない** → `stop` + `start` で擬似的に実装している
- しかし `stop` すると SDK が `sessionStopped` イベントを発火 → `setIsListening(false)` が呼ばれる可能性

**場所**: `useSpeechRecognition.ts` L146

```typescript
recognizer.sessionStopped = () => {
    setIsListening(false);  // ← pause 時にも isListening が false になる！
};
```

**影響**: 
- Pause 後に `isListening` が `false` になり、Resume ボタンのガード条件 `isListening && isPaused` が満たされなくなる
- **Resume が永久に不可能** になるデッドロック状態

---

### 🔴 BUG-3: Resume 時の状態ガード条件の矛盾

**場所**: `useSpeechRecognition.ts` L193-203 (`resumeListening`)

```typescript
const resumeListening = useCallback(() => {
    if (recognizerRef.current && isListening && isPaused) {  // ← isListening が false なら実行されない
      recognizerRef.current.startContinuousRecognitionAsync(...);
    }
  }, [isListening, isPaused]);
```

**BUG-2 との連鎖**:
1. Pause → `stopContinuousRecognitionAsync()` 実行
2. SDK が `sessionStopped` 発火 → `isListening = false`
3. Resume ボタン押下 → `isListening && isPaused` = `false && true` = **false** → 何も起きない
4. UI 上は「一時停止中」表示のまま、**操作不能**

---

### 🔴 BUG-4: Stop 時の非同期レースコンディション

**場所**: `page.tsx` L175-178 (`handleStopRecording`)

```typescript
const handleStopRecording = () => {
    stopListening();      // 非同期 (stopContinuousRecognitionAsync)
    stopAudioRecording(); // 同期的に MediaRecorder.stop()
};
```

**問題**:
- `stopListening()` は `stopContinuousRecognitionAsync` を呼ぶ非同期操作
- `stopAudioRecording()` は同期的に `mediaRecorder.stop()` を呼ぶ
- Speech SDK の stop は `recognizerRef.current?.close()` と `recognizerRef.current = null` を **コールバック内** で行う
- Stop 連打時、2回目の `stopListening()` で `recognizerRef.current` がまだ残っていれば **二重 stop** が発火

**影響**: `stopContinuousRecognitionAsync` の二重呼び出しによる例外、コールバック順序の不定

---

### 🔴 BUG-5: Pause 後の transcript 消失リスク

**場所**: `useSpeechRecognition.ts` L183

```typescript
pausedTranscriptRef.current = transcript;
```

**問題**:
- `pausedTranscriptRef` に保存した transcript は **Resume 後に使われない**
- Resume で `startContinuousRecognitionAsync` を再開すると、新しい認識結果は `setTranscript(prev => prev + ...)` で追記される
- **しかし** `startListening()` の先頭で `setTranscript("")` しているため、**再度 startListening を呼ぶと全消去** される
- Resume は `startContinuousRecognitionAsync` を直接呼ぶので消えないが、もし Resume の実装が `startListening` に変更された場合に破綻する（脆弱な設計）

---

### 🟠 BUG-6: useAudioRecorder の stopRecording がクロージャで古い isRecording を参照

**場所**: `useAudioRecorder.ts` L82-86

```typescript
const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      ...
    }
  }, [isRecording]);
```

**問題**:
- `useCallback` の依存配列に `isRecording` を含めているが、rapid click 時に **前の render の `isRecording`** を参照する可能性
- `startRecording` が完了する前に `stopRecording` が呼ばれた場合、`isRecording` がまだ `false` のため、stop が無視される
- Ref ベースのガードに変更すべき

---

### 🟠 BUG-7: page.tsx の duration カウンターが useSpeechRecognition の isListening に依存

**場所**: `page.tsx` L107-114

```typescript
useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isListening && !isPaused) {
      interval = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isListening, isPaused]);
```

**問題**:
- BUG-2 で Pause 時に `isListening` が `false` になると、duration カウンターも **停止ではなく完全終了**
- Resume しても（仮に成功したとして）`isListening` が再び `true` になるまでカウンターは再開しない
- **結果**: Pause → Resume 後に duration が停止したまま → 保存時の duration が不正確

---

## 4. 設計上の問題

### 🟡 DESIGN-1: 状態マシンの不在

現在の状態管理は **独立した boolean フラグ** の組み合わせ:

| フラグ | 管理場所 | 型 |
|--------|----------|----|
| `isListening` | useSpeechRecognition | boolean |
| `isPaused` (speech) | useSpeechRecognition | boolean |
| `isRecording` | useAudioRecorder | boolean |
| `isPaused` (audio) | useAudioRecorder | boolean |

**問題**: 4つの boolean → 16通りの組み合わせ。有効な状態はたった4つ:

```
IDLE → RECORDING → PAUSED → RECORDING → STOPPED
```

**あるべき姿**: 有限状態マシン (FSM) で制御

```typescript
type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped' | 'error';
```

無効な状態遷移を型レベルで防止すべき。

---

### 🟡 DESIGN-2: RecordingContext が未使用

`RecordingContext.tsx` は `isTranscribing`, `isTranslating`, `currentRecording` 等を持っているが、`page.tsx` では **一切使われていない**。

```tsx
// page.tsx で使われているのは AuthContext のみ
const { settings, isLoading: isAuthLoading } = useAuth();
```

**問題**:
- 録音状態が page.tsx のローカル state に閉じ込められている
- 画面遷移すると録音状態が全消失
- 将来的にバックグラウンド録音やマルチタブ対応が不可能

---

### 🟡 DESIGN-3: useRecorder.ts の存在意義

`useRecorder.ts` は `useAudioRecorder.ts` とほぼ同一の機能を持つが:

| 機能 | useRecorder | useAudioRecorder |
|------|-------------|-----------------|
| duration 管理 | ✅ (自前 timer) | ❌ |
| MIME フォールバック | ❌ (webm 固定) | ✅ |
| audio 設定 | echoCancellation, noiseSuppression, 48kHz | デフォルト |
| stream cleanup | ✅ (stopRecording 内) | 🟠 (onstop 内のみ) |
| unmount cleanup | ✅ (useEffect) | ❌ |

**問題**:
- page.tsx は `useAudioRecorder` を使用（MIME フォールバックあり、但し cleanup が弱い）
- `useRecorder` の方が堅牢だが使われていない
- **両方のいいとこ取り** をした統合版を作るべき

---

### 🟡 DESIGN-4: エラーハンドリングの統一性不足

```typescript
// page.tsx L283
const error = speechError || translationError || ttsError;
```

- 3つのエラーを OR で結合 → **同時に複数エラーがあると最初の1つしか表示されない**
- 音声録音側 (`useAudioRecorder`) の error は **含まれていない**
- エラーが発生しても録音状態がリセットされない（ユーザーが手動で Stop するしかない）

---

### 🟡 DESIGN-5: 同一マイクの二重取得

前述の BUG-1 の設計レベルの問題。

```
startListening()        → SDK が内部で getUserMedia()
startAudioRecording()   → 明示的に getUserMedia()
```

**あるべき姿**: 
```
page.tsx: stream = await getUserMedia()
├── useSpeechRecognition.start(stream)
└── useAudioRecorder.start(stream)
```

---

## 5. 依存関係マトリクス

### 5.1 Issue 間の依存関係

```
Issue #2 (録音制御) ←── Issue #7 (認証ゲート) [完了]
    │                        └── handleStartRecording に auth gate 追加済み
    │                            → 録音状態リセット前に return する可能性あり
    │
    ├──→ Issue #4 (録音保存・再生) [依存]
    │        └── audioBlob の生成が正しくないと保存も再生も壊れる
    │        └── duration の不正確さが保存データに伝播
    │
    ├──→ Issue #3 (リアルタイム翻訳) [依存]
    │        └── transcript の状態不整合が翻訳に波及
    │        └── Pause 中の翻訳挙動が未定義
    │
    └──→ Issue #5 (議事録生成) [依存]
             └── transcript の正確性に依存
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク |
|---------------|--------|--------|
| Speech SDK | Azure WebSocket | ネットワーク切断時の復帰処理なし |
| MediaRecorder | ブラウザ API | Safari の webm 非サポート |
| Duration Timer | isListening state | BUG-2 で破綻 |
| Translation | transcript state | Pause 中の挙動が不定 |
| Auth Gate | requireAuth() | 録音中の認証切れ未考慮 |

### 5.3 Issue #7 (認証ゲート) との相互作用

```typescript
// page.tsx L163
const handleStartRecording = async () => {
    if (!requireAuth("録音を開始")) return;  // ← ここで return
    // ↓ return した場合、以下は実行されない（正しい動作）
    setDuration(0);
    resetTranscript();
    resetAudioRecording();
    startListening();
    await startAudioRecording();
};
```

**考慮点**: 
- 認証ゲートは Start 前にのみチェック → **録音中に認証が切れた場合のハンドリングなし**
- SWA の認証セッションが切れても録音は続行 → API 呼び出し（保存等）で初めてエラー
- **推奨**: 録音中は認証チェック不要（UX優先）、保存時に再チェック（現在の動作で OK）

---

## 6. ブラウザ互換性リスク

| ブラウザ | MediaRecorder | Speech SDK | リスク |
|---------|---------------|------------|--------|
| Chrome Desktop | ✅ webm/opus | ✅ | 低 |
| Firefox | ✅ webm/opus | ✅ | 低 |
| Safari Desktop | 🟠 mp4 のみ | ✅ | MIME fallback 必要 |
| Safari iOS | 🔴 制限あり | 🟠 制限あり | getUserMedia 制限 |
| Chrome Android | ✅ | ✅ | 中（バックグラウンド制限）|
| Edge | ✅ | ✅ | 低 |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### 7.1 有限状態マシンの導入

```typescript
// useRecordingStateMachine.ts (新規)
type RecordingState = 'idle' | 'starting' | 'recording' | 'pausing' | 'paused' | 'resuming' | 'stopping' | 'stopped' | 'error';

type RecordingAction = 
  | { type: 'START' }
  | { type: 'START_SUCCESS' }
  | { type: 'START_FAILURE'; error: string }
  | { type: 'PAUSE' }
  | { type: 'PAUSE_SUCCESS' }
  | { type: 'RESUME' }
  | { type: 'RESUME_SUCCESS' }
  | { type: 'STOP' }
  | { type: 'STOP_SUCCESS' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

// 有効な遷移のみ許可
const transitions: Record<RecordingState, Partial<Record<RecordingAction['type'], RecordingState>>> = {
  idle:      { START: 'starting' },
  starting:  { START_SUCCESS: 'recording', START_FAILURE: 'error' },
  recording: { PAUSE: 'pausing', STOP: 'stopping', ERROR: 'error' },
  pausing:   { PAUSE_SUCCESS: 'paused', ERROR: 'error' },
  paused:    { RESUME: 'resuming', STOP: 'stopping' },
  resuming:  { RESUME_SUCCESS: 'recording', ERROR: 'error' },
  stopping:  { STOP_SUCCESS: 'stopped', ERROR: 'error' },
  stopped:   { RESET: 'idle', START: 'starting' },
  error:     { RESET: 'idle' },
};
```

#### 7.2 sessionStopped の Pause 対応

```typescript
// pauseListening 時にフラグを立てて、sessionStopped で isListening を変えないようにする
const isPausingRef = useRef(false);

recognizer.sessionStopped = () => {
    if (!isPausingRef.current) {
        setIsListening(false);  // 本当の停止時のみ
    }
};

const pauseListening = () => {
    isPausingRef.current = true;
    recognizer.stopContinuousRecognitionAsync(() => {
        setIsPaused(true);
        // isPausingRef は resume 後に false に戻す
    });
};
```

#### 7.3 共有 MediaStream

```typescript
// page.tsx - 単一ストリームを取得して両方に渡す
const handleStartRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startListening(stream);     // stream を受け取れるように改修
    startAudioRecording(stream); // stream を受け取れるように改修
};
```

#### 7.4 Rapid Click 防止（デバウンス + 状態ガード）

```typescript
const handleStopRecording = useCallback(() => {
    if (state !== 'recording' && state !== 'paused') return;  // FSM ガード
    dispatch({ type: 'STOP' });
    // 非同期操作は FSM が管理
}, [state]);
```

### Phase 2: 設計改善（P1）

1. `useRecorder` と `useAudioRecorder` を統合 → `useAudioCapture`
2. `RecordingContext` に録音状態マシンを配置（画面遷移対応）
3. エラー配列化（複数エラー同時表示）
4. Network disconnect 検知 & 自動再接続

### Phase 3: 堅牢性強化（P2）

1. `beforeunload` イベントで録音中の離脱防止
2. Visibility API でバックグラウンド遷移時の処理
3. WebWorker ベースの duration 計測（setInterval の精度問題対応）
4. AudioWorklet によるリアルタイム音量メーター

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

```
idle → START → recording → PAUSE → paused → RESUME → recording → STOP → stopped
idle → START → recording → STOP → stopped
idle → START → error (マイク拒否)
recording → PAUSE → paused → STOP → stopped (一時停止中から直接停止)
rapid: START → STOP → START → STOP (連打テスト)
```

### 8.2 統合テスト

- Speech SDK mock + MediaRecorder mock での E2E フロー
- ネットワーク切断シミュレーション
- ブラウザ権限拒否シミュレーション

### 8.3 手動テスト（ブラウザ別）

| シナリオ | Chrome | Safari | Firefox | Edge |
|---------|--------|--------|---------|------|
| 録音 → 停止 | | | | |
| 録音 → 一時停止 → 再開 → 停止 | | | | |
| 録音 → 一時停止 → 停止 | | | | |
| 連打テスト | | | | |
| 長時間録音 (30分) | | | | |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `useRecordingStateMachine` FSM 作成 | 2h | 新規ファイル |
| 2 | `useSpeechRecognition` の Pause/Resume 修正 | 3h | hooks 1ファイル |
| 3 | `useAudioRecorder` + `useRecorder` 統合 | 2h | hooks 2ファイル → 1ファイル |
| 4 | 共有 MediaStream 実装 | 2h | page.tsx + hooks |
| 5 | page.tsx の orchestration を FSM ベースに書き換え | 3h | page.tsx |
| 6 | エラーハンドリング統一 | 1h | page.tsx |
| 7 | テスト作成 & ブラウザテスト | 3h | テストファイル |
| **合計** | | **16h** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Speech SDK の Pause 代替実装が不安定 | 高 | 高 | isPausingRef ガードで制御 |
| 共有 MediaStream で音声品質劣化 | 低 | 中 | 単一 stream からの clone() で分離 |
| FSM 導入で既存テスト破綻 | 中 | 低 | テストがないので影響なし |
| Safari での MediaRecorder 互換性 | 高 | 高 | polyfill + フォールバック MIME |
| 認証ゲート(#7)との回帰 | 低 | 中 | auth gate は handleStart の先頭で return するのみ |

---

## 11. 結論

**現状の最大の問題は「状態マシンの不在」に起因する**。個別のバグ修正ではなく、FSM を中心とした **アーキテクチャレベルの再設計** が必要。特に BUG-2/BUG-3 の「Pause → Resume デッドロック」は P0 として即時対応が必要。

修正の順序は:
1. **FSM 導入**（全ての修正の基盤）
2. **sessionStopped ハンドラ修正**（Pause デッドロック解消）
3. **共有 MediaStream**（リソースリーク解消）
4. **Hook 統合**（保守性向上）

この修正は Issue #3, #4, #5 の前提条件となるため、最優先で着手すべき。
