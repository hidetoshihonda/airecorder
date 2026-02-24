# Issue #172: PC録音時にマイクタイプ選択で Not supported エラー — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: Issue #167 で実装されたシステム音声キャプチャ機能の `getDisplayMedia()` 呼び出しで `video: false` を指定しており、**Web標準仕様に違反**している。これにより `TypeError` が発生し、"system" / "both" モードでの録音が完全に不可能。さらに、React state の非同期更新に起因するレースコンディションにより、**取得した共有ストリームが Speech SDK に渡されない**サイレントバグも存在する。
- **影響範囲**: PC ブラウザ（Chrome/Edge）で "Mic + System" または "System" モードを選択した全ユーザー（100%）が録音不可。"Mic" モードは表面上動作するが内部的に非効率（3重ストリーム取得）。
- **緊急度**: **P0 — Critical** 。コア機能（録音）が特定モードで完全に使用不能。

---

## 2. アーキテクチャ概観

### コンポーネント依存関係図

```
page.tsx (メインページ)
├── useAudioSource(audioSourceMode)     ← BUG-1, BUG-2 の震源地
│   ├── getUserMedia()                  [mic モード]
│   ├── getDisplayMedia()               [system/both モード] ← video:false で TypeError
│   └── AudioContext (ミックス)          [both モード]
│
├── useSpeechRecognition({ sharedStream })  ← sharedStream が null のまま使われる
│   ├── SpeechRecognizer
│   └── ConversationTranscriber
│       └── AudioConfig.fromStreamInput(pushStream) or fromDefaultMicrophoneInput()
│
├── useTranslationRecognizer({ sharedStream })  ← 同上
│   └── TranslationRecognizer
│       └── AudioConfig.fromStreamInput(pushStream) or fromDefaultMicrophoneInput()
│
├── useAudioRecorder({ sharedStream })  ← 同上
│   └── MediaRecorder
│
└── settings/page.tsx
    └── defaultAudioSource 設定  ← サポート有無の検証なし
```

### データフロー図（理想形 vs 実際）

**理想形:**
```
User clicks Record
  → acquireStream() → MediaStream (mic/system/both)
  → sharedStream が React state 経由で各フックに伝搬
  → Speech SDK: fromStreamInput(sharedStream)
  → AudioRecorder: MediaRecorder(sharedStream)
```

**実際の動作（バグあり）:**
```
User clicks Record
  → acquireStream() → [system/both] getDisplayMedia({video:false}) → TypeError! 💥
                       [mic] getUserMedia() → setStream(stream) → 返り値は破棄
  → startListening() → sharedStream は null（state 未更新）→ fromDefaultMicrophoneInput() ← 別マイク
  → startAudioRecording() → sharedStream は null → getUserMedia() ← さらに別マイク
```

### 状態管理の構造

| state 変数 | 管理場所 | 説明 |
|-----------|---------|------|
| `audioSourceMode` | `page.tsx` (useState) | "mic" / "system" / "both" |
| `stream` (= sharedStream) | `useAudioSource` (useState) | 取得済みストリーム |
| `isAcquiring` | `useAudioSource` (useState) | 取得中フラグ |
| `error` | `useAudioSource` (useState) | エラーメッセージ |

---

## 3. 重大バグ分析 🔴

### BUG-1: `getDisplayMedia({ video: false })` が TypeError を投げる [Critical]

**場所**: [useAudioSource.ts](../web/src/hooks/useAudioSource.ts#L68-L73)

**コード**:
```typescript
const displayStream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
    video: false,     // ← ここが問題！
    audio: true,
    systemAudio: "include",
} as any);
```

**問題**: MDN Web Docs で明確に規定されている通り、`getDisplayMedia()` の `video` オプションを `false` に設定すると **TypeError で reject** される。

> "If false, the promise rejects with TypeError since getDisplayMedia() requires a video track."
> — [MDN: MediaDevices.getDisplayMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

Chrome/Edge では以下のエラーが発生する:
```
TypeError: Failed to execute 'getDisplayMedia' on 'MediaDevices': video must not be false
```

**影響**: "system" および "both" モードでの録音が **100% 失敗** する。ユーザーにはエラーバナーが表示され、録音を開始できない。

**根本原因**: Issue #167 の実装時に、「ビデオトラックは不要だから `video: false` にすればよい」と誤解した。`getDisplayMedia` は画面共有APIであり、最低限ビデオトラックの取得が必須（取得後に不要なら `stop()` で破棄する）。実際にコード L77 で `displayStream.getVideoTracks().forEach((track) => track.stop())` が存在するが、そもそも `video: false` のためビデオトラックが取得されず、この行には到達しない。

**修正方針**:
```typescript
const displayStream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,      // ← video: true に変更（取得後に stop で破棄）
    audio: true,
    // systemAudio は Experimental — 対応ブラウザのみで有効
    ...(typeof navigator !== "undefined" && "getDisplayMedia" in (navigator.mediaDevices || {})
      ? { systemAudio: "include" } : {}),
} as DisplayMediaStreamOptions);
```

---

### BUG-2: React state レースコンディション — sharedStream が null のまま使用される [High]

**場所**: [page.tsx](../web/src/app/page.tsx#L499-L503)

**コード**:
```typescript
// handleStartRecording 内
await acquireStream();          // setStream(resultStream) → state 更新は非同期
startListening();               // sharedStream は前回 render の null を参照
await startAudioRecording();    // sharedStream は前回 render の null を参照
```

**問題**: `acquireStream()` 内部で `setStream(resultStream)` が呼ばれるが、React の state 更新は **次回レンダリングまで反映されない**。したがって、直後に呼ばれる `startListening()` および `startAudioRecording()` に渡る `sharedStream` は `null` のままである。

各フック内の fallback 動作:
- `useSpeechRecognition`: `sharedStream = null` → `AudioConfig.fromDefaultMicrophoneInput()` （デフォルトマイク）
- `useTranslationRecognizer`: 同上
- `useAudioRecorder`: `sharedStream = null` → 独自に `getUserMedia()` を呼ぶ

**影響**:
1. **"mic" モード**: 3つの独立したマイクストリームが同時にオープンされる（useAudioSource + SpeechSDK + MediaRecorder）。機能的には動作するが、リソース浪費でデバイスによっては音質劣化やマイク占有問題が発生しうる。
2. **"system" / "both" モード**: BUG-1 が修正されたとしても、Speech SDK にシステム音声ストリームが渡されないため、**システム音声の文字起こしが機能しない**。音声録音（MediaRecorder）も同様にシステム音声を取得できない。

**根本原因**: `acquireStream()` は `Promise<MediaStream>` を返すが、`handleStartRecording` で返り値が **破棄** されている（`await acquireStream()` の結果を変数に代入していない）。React の state 更新の非同期性を考慮せず、state 経由での共有に依存している。

**修正方針**: `acquireStream()` の返り値を使い、直接 `startListening` / `startAudioRecording` に渡す。各フックのインターフェースに stream パラメータを追加する必要がある。

```typescript
// page.tsx: handleStartRecording
const stream = await acquireStream();
startListening(stream);           // stream を直接渡す
await startAudioRecording(stream); // stream を直接渡す
```

---

### BUG-3: 設定画面で非対応ブラウザでも system/both が選択可能 [Medium]

**場所**: [settings/page.tsx](../web/src/app/settings/page.tsx#L378-L403)

**コード**:
```tsx
<Select
  value={settings.defaultAudioSource ?? "mic"}
  onValueChange={(v) =>
    handleSettingChange({ defaultAudioSource: v as "mic" | "system" | "both" })
  }
>
  <SelectContent>
    <SelectItem value="mic">...</SelectItem>
    <SelectItem value="system">...</SelectItem>  // ← 常に表示
    <SelectItem value="both">...</SelectItem>     // ← 常に表示
  </SelectContent>
</Select>
```

**問題**: 設定画面では `isSystemAudioSupported` のチェックがなく、全ブラウザ・全環境で "system" と "both" オプションが表示される。非対応ブラウザ（Safari, Firefox）でこれらを選択した場合、メインページに遷移後に録音が失敗する。

**影響**: 非対応ブラウザのユーザー（推定 15-20%）が設定変更後に録音不能になる可能性がある。

**修正方針**: メインページと同様に `isSystemAudioSupported` チェックを追加し、非対応の場合は "system" / "both" をdisabledまたは非表示にする。

---

## 4. 設計上の問題 🟡

### DESIGN-1: useAudioSource と各フックの統合アーキテクチャが不完全

Issue #167 の実装で `useAudioSource` フックは作成されたが、既存フック（`useSpeechRecognition`, `useTranslationRecognizer`, `useAudioRecorder`）との統合が **React の state 伝搬モデルと整合しない設計** になっている。

現在の設計:
```
useAudioSource → stream (state)  → page.tsx → sharedStream (prop) → 各フック
```

問題: state 更新→prop伝搬→useCallback再生成の間に **1レンダリングサイクルのラグ** が必然的に存在する。

✅ **推奨設計**: `acquireStream()` が返す `Promise<MediaStream>` を直接使うインペラティブパターンに変更する:
```
acquireStream() → stream (Promise 解決値) → startListening(stream) / startAudioRecording(stream)
```

### DESIGN-2: `as any` キャストによる型安全性の欠如

[useAudioSource.ts L73](../web/src/hooks/useAudioSource.ts#L73) で `as any` が使われており、TypeScript による `video: false` の検出を回避している。`DisplayMediaStreamOptions` 型を適切に拡張すべき。

### DESIGN-3: audioStreamAdapter.ts の ScriptProcessorNode は deprecated

[audioStreamAdapter.ts L45-50](../web/src/lib/audioStreamAdapter.ts#L45-L50) で `ScriptProcessorNode` を使用している。deprecated だが全ブラウザで動作するためコメントで注記されている。将来的に `AudioWorkletNode` への移行を検討すべきだが、現時点では P3（低優先度）。

### DESIGN-4: ✅ Good — エラー表示の統合設計

[page.tsx L331](../web/src/app/page.tsx#L331) で `audioSourceError` が `errors` 配列に含まれており、ユーザーにエラーが適切に表示される設計は良い。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #172 ←── Issue #167 [直接依存: #167 の実装バグが #172 の原因]
Issue #172 ──→ Issue #35  [間接影響: SDK モードでも sharedStream を使用]
```

- Issue #172 の修正は **単独でブロッカーなしに実施可能**
- 他 Issue へのブロッカーにはならない

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `useAudioSource` | `getDisplayMedia` API | ブラウザ互換性 | video: true + track.stop() で標準仕様に準拠 |
| `useSpeechRecognition` | `audioStreamAdapter` | PushStream の安定性 | 既存実装を維持（動作確認済み） |
| `useAudioRecorder` | `MediaRecorder` API | ストリーム受け渡し | `startRecording(stream)` パラメータ既存 |
| 設定画面 | `navigator.mediaDevices` | SSR 時の undefined | `typeof navigator !== "undefined"` チェック |

### 5.3 他 Issue/機能との相互作用

- **Issue #35 (Speech Translation SDK)**: `useTranslationRecognizer` も `sharedStream` を使うため、BUG-2 の修正は SDK モードにも恩恵がある
- **Issue #167 (System Audio Capture)**: 本 Issue は #167 の実装不備の修正であり、#167 の設計意図を正しく実現する

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Win/Mac) | ✅ getDisplayMedia + systemAudio サポート | `video: false` 修正で解決 |
| Edge (Win) | ✅ Chrome と同等 | 同上 |
| Firefox | ⚠️ getDisplayMedia はあるが systemAudio 未対応 | systemAudio は無視されるだけ（エラーにはならない） |
| Safari | ❌ getDisplayMedia の audio 制限あり | system/both モードは非対応のまま |
| iOS Safari | ❌ getDisplayMedia 未対応 | `isSystemAudioSupported = false` で正しく判定 |
| モバイル Chrome | ⚠️ getDisplayMedia 制限あり | 同上 |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### Fix-1: `getDisplayMedia({ video: false })` → `video: true` に修正

**対象ファイル**: `web/src/hooks/useAudioSource.ts`

```typescript
// Before (BUG)
const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: false,
    audio: true,
    systemAudio: "include",
} as any);

// After (FIX)
const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,       // getDisplayMedia は video: true が必須
    audio: true,
    systemAudio: "include",
} as DisplayMediaStreamOptions & { systemAudio?: string });

// video トラックは不要なので即座に停止（既存コードと同じ）
displayStream.getVideoTracks().forEach((track) => track.stop());
```

#### Fix-2: レースコンディション解消 — stream を直接渡す

**対象ファイル**: `web/src/app/page.tsx`, `web/src/hooks/useSpeechRecognition.ts`, `web/src/hooks/useTranslationRecognizer.ts`

```typescript
// page.tsx: handleStartRecording
const stream = await acquireStream();
startListening(stream);
await startAudioRecording(stream);
```

```typescript
// useSpeechRecognition: startListening に引数を追加
const startListening = useCallback((streamOverride?: MediaStream | null) => {
    // streamOverride > sharedStream > fromDefaultMicrophoneInput の優先順位
    const activeStream = streamOverride ?? sharedStream;
    let audioConfig: SpeechSDK.AudioConfig;
    if (activeStream) {
        const { pushStream, cleanup } = createPushStreamFromMediaStream(activeStream);
        audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
        pushStreamCleanupRef.current = cleanup;
    } else {
        audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    }
    // ...
}, [sharedStream, ...]);
```

同様の変更を `useTranslationRecognizer` にも適用。

`useAudioRecorder` は既に `startRecording(stream?: MediaStream)` パラメータを持っているため、呼び出し側の変更のみ:
```typescript
await startAudioRecording(stream);  // stream を渡す
```

### Phase 2: 設計改善（P1）

#### Fix-3: 設定画面のブラウザサポートチェック

**対象ファイル**: `web/src/app/settings/page.tsx`

```tsx
// 設定画面でも isSystemAudioSupported をチェック
const isSystemAudioSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    "getDisplayMedia" in navigator.mediaDevices;

// system/both オプションを条件付きで表示
<SelectItem value="system" disabled={!isSystemAudioSupported}>
    ...
</SelectItem>
<SelectItem value="both" disabled={!isSystemAudioSupported}>
    ...
</SelectItem>
```

### Phase 3: 堅牢性強化（P2）

#### Fix-4: `as any` キャストの排除

```typescript
// 型を正しく拡張
interface ExtendedDisplayMediaStreamOptions extends DisplayMediaStreamOptions {
    systemAudio?: "include" | "exclude";
}
```

#### Fix-5: systemAudio 非対応時のグレースフルフォールバック

```typescript
// systemAudio が非対応の場合はオプションから除外
const displayMediaOptions: ExtendedDisplayMediaStreamOptions = {
    video: true,
    audio: true,
};
// Chrome 105+ でのみ systemAudio を追加
try {
    displayMediaOptions.systemAudio = "include";
} catch { /* 無視 */ }
```

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|------------|------|---------|
| mic モードで acquireStream | mode="mic" | getUserMedia 呼び出し、stream 取得成功 |
| system モードで acquireStream | mode="system" | getDisplayMedia({video:true}) 呼び出し、audio トラックのみ残る |
| both モードで acquireStream | mode="both" | getUserMedia + getDisplayMedia、AudioContext でミックス |
| system モードで非対応ブラウザ | isSystemAudioSupported=false | エラーメッセージ表示 |
| acquireStream の返り値が startListening に渡される | - | Speech SDK に正しいストリームが使われる |

### 統合テスト

| シナリオ | 検証ポイント |
|---------|------------|
| mic モードで録音 → 停止 → 再生 | 音声が正しく録音されている |
| both モードで録音（Chrome） | システム音声 + マイク音声の両方が録音される |
| 設定で both を選択 → メインページで録音 | デフォルトモードが正しく反映される |
| 非対応ブラウザで設定画面を開く | system/both が disabled |

### 手動テスト: ブラウザ別マトリクス

| ブラウザ | mic | system | both |
|---------|-----|--------|------|
| Chrome (Win) | ✅ | ✅ | ✅ |
| Edge (Win) | ✅ | ✅ | ✅ |
| Firefox (Win) | ✅ | ⚠️ (systemAudio なし) | ⚠️ |
| Safari (Mac) | ✅ | ❌ (非表示) | ❌ (非表示) |
| Chrome (Android) | ✅ | ❌ (非表示) | ❌ (非表示) |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | BUG-1 修正: `video: false` → `video: true` | 5分 | `useAudioSource.ts` |
| 2 | BUG-2 修正: `startListening` に stream パラメータ追加 | 20分 | `useSpeechRecognition.ts`, `useTranslationRecognizer.ts`, `page.tsx` |
| 3 | BUG-3 修正: 設定画面のサポートチェック | 10分 | `settings/page.tsx` |
| 4 | 型安全性改善 (`as any` 排除) | 5分 | `useAudioSource.ts` |
| 5 | ブラウザテスト (Chrome/Edge) | 15分 | - |
| **合計** | | **約55分** | **5ファイル** |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| `video: true` でユーザーに画面選択ダイアログが表示される | 確実 | 低 | これは `getDisplayMedia` の仕様動作。ユーザーガイダンスを表示 |
| `systemAudio: "include"` が一部ブラウザで無視される | 中 | 中 | フォールバックで通常の画面共有音声を取得 |
| `startListening` のインターフェース変更による regression | 低 | 高 | 引数をオプショナルにし、後方互換性を維持 |
| AudioContext ミキシング品質の問題 | 低 | 中 | 既存ロジックは変更せず、ストリーム受け渡しのみ修正 |

---

## 11. 結論

### 最大の問題点

1. **BUG-1 (Critical)**: `getDisplayMedia({ video: false })` は Web 標準仕様違反。system/both モードの録音が 100% 失敗する。
2. **BUG-2 (High)**: React state のレースコンディションにより、`sharedStream` が Speech SDK / MediaRecorder に渡されない。BUG-1 が修正されてもシステム音声の文字起こしが機能しない。

### 推奨する修正順序

1. **BUG-1** → **BUG-2** → **BUG-3** → 型安全性改善
2. BUG-1 と BUG-2 は **必ずセットで修正** する（BUG-1 だけ直しても BUG-2 により system 音声が SDK に渡らない）

### 他 Issue への影響サマリー

- Issue #35 (Speech Translation): BUG-2 修正により SDK モードでも sharedStream が正しく使われるようになる（改善）
- Issue #167 (System Audio): 本修正により #167 の設計意図が正しく実現される

### 判定: **CONDITIONAL GO**

BUG-1 + BUG-2 をセットで修正すれば安全にデプロイ可能。`startListening` のインターフェース変更は後方互換性を維持する設計とすること。
