# Issue #172: PC録音時 Not supported エラー — 実装計画書

## 概要

Issue #167 で追加されたシステム音声キャプチャ機能に 2 つの致命的バグが存在する。
本計画書では、分析レビューで特定された BUG-1 〜 BUG-3 の修正手順を具体的に記述する。

---

## 修正対象ファイル一覧

| # | ファイル | 修正内容 | 優先度 |
|---|---------|---------|--------|
| 1 | `web/src/hooks/useAudioSource.ts` | `video: false` → `video: true`、型改善 | P0 |
| 2 | `web/src/hooks/useSpeechRecognition.ts` | `startListening` に stream 引数追加 | P0 |
| 3 | `web/src/hooks/useTranslationRecognizer.ts` | `startListening` に stream 引数追加 | P0 |
| 4 | `web/src/app/page.tsx` | `acquireStream` 返り値を各フックに渡す | P0 |
| 5 | `web/src/app/settings/page.tsx` | 非対応ブラウザでの選択肢制御 | P1 |

---

## Step 1: `getDisplayMedia` の修正（BUG-1）

### ファイル: `web/src/hooks/useAudioSource.ts`

#### 変更箇所 1-A: `getSystemStream` — `video: false` → `video: true`

**L67-78 を修正:**

```typescript
// Before
const getSystemStream = useCallback(async (): Promise<MediaStream> => {
    const displayStream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: false,
      audio: true,
      systemAudio: "include",
    } as any);

    // video トラックは不要なので削除
    displayStream.getVideoTracks().forEach((track) => track.stop());

// After
const getSystemStream = useCallback(async (): Promise<MediaStream> => {
    const displayStream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,       // getDisplayMedia は video: true が必須（spec準拠）
      audio: true,
      systemAudio: "include",
    } as DisplayMediaStreamOptions & { systemAudio?: string });

    // video トラックは不要なので即座に停止
    displayStream.getVideoTracks().forEach((track) => track.stop());
```

**変更ポイント:**
1. `video: false` → `video: true` — Web 標準仕様に準拠
2. `as any` → `as DisplayMediaStreamOptions & { systemAudio?: string }` — 型安全性向上

---

## Step 2: レースコンディション修正（BUG-2）

### ファイル: `web/src/hooks/useSpeechRecognition.ts`

#### 変更箇所 2-A: `startListening` に `streamOverride` パラメータ追加

**インターフェース（L26）を修正:**
```typescript
// Before
startListening: () => void;

// After
startListening: (streamOverride?: MediaStream | null) => void;
```

**`startConversationTranscriber` 関数（L62-74）を修正:**
```typescript
// Before
const startConversationTranscriber = useCallback(
    (speechConfig: SpeechSDK.SpeechConfig) => {
      let audioConfig: SpeechSDK.AudioConfig;
      if (sharedStream) {
        const { pushStream, cleanup } = createPushStreamFromMediaStream(sharedStream);
        ...
      }
    },
    [phraseList, sharedStream]
  );

// After
const startConversationTranscriber = useCallback(
    (speechConfig: SpeechSDK.SpeechConfig, activeStream?: MediaStream | null) => {
      const streamToUse = activeStream ?? sharedStream;
      let audioConfig: SpeechSDK.AudioConfig;
      if (streamToUse) {
        const { pushStream, cleanup } = createPushStreamFromMediaStream(streamToUse);
        ...
      }
    },
    [phraseList, sharedStream]
  );
```

**`startListening` 関数（L145-247）を修正:**
```typescript
// Before
const startListening = useCallback(() => {
    ...
    if (enableSpeakerDiarization) {
        startConversationTranscriber(speechConfig);
    } else {
        let audioConfig: SpeechSDK.AudioConfig;
        if (sharedStream) {
            const { pushStream, cleanup } = createPushStreamFromMediaStream(sharedStream);
            ...
        }
    }
}, [..., sharedStream]);

// After
const startListening = useCallback((streamOverride?: MediaStream | null) => {
    ...
    const activeStream = streamOverride ?? sharedStream;
    if (enableSpeakerDiarization) {
        startConversationTranscriber(speechConfig, activeStream);
    } else {
        let audioConfig: SpeechSDK.AudioConfig;
        if (activeStream) {
            const { pushStream, cleanup } = createPushStreamFromMediaStream(activeStream);
            ...
        }
    }
}, [..., sharedStream]);
```

### ファイル: `web/src/hooks/useTranslationRecognizer.ts`

#### 変更箇所 2-B: `startListening` に `streamOverride` パラメータ追加

**同様の変更パターンを適用:**

```typescript
// Before (L97)
const startListening = useCallback(() => {

// After
const startListening = useCallback((streamOverride?: MediaStream | null) => {
```

```typescript
// Before (L122-128)
if (sharedStream) {
    const { pushStream, cleanup } = createPushStreamFromMediaStream(sharedStream);
    ...
}

// After
const activeStream = streamOverride ?? sharedStream;
if (activeStream) {
    const { pushStream, cleanup } = createPushStreamFromMediaStream(activeStream);
    ...
}
```

### ファイル: `web/src/app/page.tsx`

#### 変更箇所 2-C: `handleStartRecording` で stream を直接渡す

```typescript
// Before (L499-503)
try {
    await acquireStream();
    startListening();
    await startAudioRecording();
    dispatch({ type: "START_SUCCESS" });
}

// After
try {
    const stream = await acquireStream();
    startListening(stream);
    await startAudioRecording(stream);
    dispatch({ type: "START_SUCCESS" });
}
```

**注意**: `startAudioRecording` は `useAudioRecorder` の `startRecording` であり、既に `stream?: MediaStream` パラメータを受け付ける（L69）。呼び出し側の変更のみで対応可能。

---

## Step 3: 設定画面のサポートチェック（BUG-3）

### ファイル: `web/src/app/settings/page.tsx`

#### 変更箇所 3-A: `isSystemAudioSupported` チェックの追加

**コンポーネント内に判定ロジックを追加:**
```typescript
// 設定ページ コンポーネント内に追加
const isSystemAudioSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    "getDisplayMedia" in navigator.mediaDevices;
```

#### 変更箇所 3-B: system/both オプションの条件付き表示

```tsx
// Before
<SelectItem value="system">
    <span className="flex items-center gap-2">
        <Monitor className="h-4 w-4" />
        {t("audioSourceSystem")}
    </span>
</SelectItem>
<SelectItem value="both">
    <span className="flex items-center gap-2">
        <Mic className="h-4 w-4" />+<Monitor className="h-4 w-4" />
        {t("audioSourceBoth")}
    </span>
</SelectItem>

// After
{isSystemAudioSupported && (
    <SelectItem value="system">
        <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            {t("audioSourceSystem")}
        </span>
    </SelectItem>
)}
{isSystemAudioSupported && (
    <SelectItem value="both">
        <span className="flex items-center gap-2">
            <Mic className="h-4 w-4" />+<Monitor className="h-4 w-4" />
            {t("audioSourceBoth")}
        </span>
    </SelectItem>
)}
```

#### 変更箇所 3-C: 非対応ブラウザで system/both が保存されている場合のフォールバック

```tsx
// defaultAudioSource が system/both だが、非対応ブラウザの場合はフォールバック
const effectiveDefaultAudioSource =
    (settings.defaultAudioSource === "system" || settings.defaultAudioSource === "both")
    && !isSystemAudioSupported
        ? "mic"
        : (settings.defaultAudioSource ?? "mic");
```

---

## デプロイ手順

```bash
# 1. ブランチ作成
git checkout -b fix/issue-172-not-supported-error

# 2. 修正実施（Step 1 → 2 → 3 の順）

# 3. ローカルビルド確認
cd web && npm run build

# 4. コミット
git add -A
git commit -m "fix: resolve getDisplayMedia video:false TypeError and stream race condition (#172)"

# 5. プッシュ & PR 作成
git push origin fix/issue-172-not-supported-error
gh pr create --title "fix: PC録音時 Not supported エラー修正 (#172)" \
  --body "## 修正内容\n- BUG-1: getDisplayMedia video:false → video:true\n- BUG-2: React state race condition — stream を直接渡す\n- BUG-3: 設定画面の非対応ブラウザチェック\n\nCloses #172" \
  --label "bug,P0"
```

---

## テスト確認事項

### 最低限の確認（P0修正のリリース判定）

- [ ] Chrome (PC) で "Mic" モードで録音できる
- [ ] Chrome (PC) で "Mic + System" モードで録音できる（画面選択ダイアログが表示される）
- [ ] Chrome (PC) で "System" モードで録音できる
- [ ] 録音した音声にシステム音声が含まれている（both/system モード）
- [ ] 文字起こしがシステム音声を認識している（both/system モード）
- [ ] 設定画面で defaultAudioSource を "both" に変更 → メインページで正しく反映される
- [ ] エラーが出ない（コンソールにも TypeError/NotSupportedError なし）

### 追加確認（P1）

- [ ] Safari でメインページを開く → 音声ソースセレクターが非表示
- [ ] Firefox で設定画面を開く → system/both が非表示
- [ ] 録音中にユーザーが「共有を停止」→ エラーメッセージが表示される
- [ ] モバイルブラウザで正常に mic モードで録音できる
