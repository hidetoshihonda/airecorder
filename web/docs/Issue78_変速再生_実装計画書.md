# Issue #78: 録音の変速再生（0.5x〜2.0x） — 実装計画書

> 作成日: 2026-02-11
> 対象 Issue: #78 (G-08)
> Phase: 1（クイックウィン）
> 前提ドキュメント: `docs/Issue78_変速再生_分析レビュー.md`

---

## 実装概要

録音詳細ページ（`/recording`）の `<audio>` プレイヤーに再生速度変更UIを追加する。
HTML5 Audio の `playbackRate` プロパティを利用し、新規ライブラリの導入は不要。

---

## 変更対象ファイル一覧

| # | ファイル | 変更種別 | 内容 |
|---|---------|---------|------|
| 1 | `web/src/app/recording/page.tsx` | **編集** | audioRef追加、playbackRate state、速度選択UI |
| 2 | `web/messages/ja.json` | **編集** | `RecordingDetail.playbackSpeed` 追加 |
| 3 | `web/messages/en.json` | **編集** | 同上 |
| 4 | `web/messages/es.json` | **編集** | 同上 |

**新規ファイル: なし**
**削除ファイル: なし**
**新規依存パッケージ: なし**

---

## 詳細実装手順

### Step 1: `recording/page.tsx` — import と state 追加

**場所**: `RecordingDetailContent` 関数の先頭付近

```diff
+ import { useState, useEffect, useMemo, useRef, Suspense } from "react";
- import { useState, useEffect, useMemo, Suspense } from "react";
```

state 追加（`audioUrl` state の近くに配置）:

```typescript
const audioRef = useRef<HTMLAudioElement>(null);
const [playbackRate, setPlaybackRate] = useState(1.0);
```

### Step 2: 速度変更ハンドラ追加

**場所**: `RecordingDetailContent` 関数内（handleCopy 等の他のハンドラ近く）

```typescript
const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

const handlePlaybackRateChange = (rate: number) => {
  setPlaybackRate(rate);
  if (audioRef.current) {
    audioRef.current.playbackRate = rate;
    // Safari 互換性: webkitPreservesPitch フォールバック
    if ('preservesPitch' in audioRef.current) {
      audioRef.current.preservesPitch = true;
    } else if ('webkitPreservesPitch' in audioRef.current) {
      (audioRef.current as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch = true;
    }
  }
};
```

### Step 3: `<audio>` タグと速度選択UIの修正

**場所**: L645-693 付近の Audio Player セクション

**変更前** (L655-659):
```tsx
<audio controls className="flex-1" src={audioUrl}>
  {t("audioNotSupported")}
</audio>
```

**変更後**:
```tsx
<div className="flex flex-col gap-2 flex-1">
  <audio
    ref={audioRef}
    controls
    className="w-full"
    src={audioUrl}
    onPlay={() => {
      if (audioRef.current) {
        audioRef.current.playbackRate = playbackRate;
      }
    }}
  >
    {t("audioNotSupported")}
  </audio>
  <div className="flex items-center gap-1">
    <span className="text-xs text-muted-foreground mr-1">
      {t("playbackSpeed")}
    </span>
    {PLAYBACK_RATES.map((rate) => (
      <button
        key={rate}
        type="button"
        className={cn(
          "h-6 px-2 text-xs rounded-md transition-colors",
          playbackRate === rate
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent"
        )}
        onClick={() => handlePlaybackRateChange(rate)}
      >
        {rate === 1.0 ? "1x" : `${rate}x`}
      </button>
    ))}
  </div>
</div>
```

### Step 4: i18n キー追加

**`web/messages/ja.json`** — `RecordingDetail` セクション内に追加:
```json
"playbackSpeed": "再生速度"
```

**`web/messages/en.json`**:
```json
"playbackSpeed": "Speed"
```

**`web/messages/es.json`**:
```json
"playbackSpeed": "Velocidad"
```

---

## 技術詳細

### `playbackRate` API

| プロパティ | 型 | デフォルト | 備考 |
|-----------|-----|----------|------|
| `HTMLAudioElement.playbackRate` | `number` | `1.0` | 0.25〜5.0 の範囲が一般的 |
| `HTMLAudioElement.preservesPitch` | `boolean` | `true` | 速度変更時に音程を維持 |

### Safari 互換性

Safari は `preservesPitch` の代わりに `webkitPreservesPitch` を使用する場合がある。
上記コードでフォールバック処理済み。

### `onPlay` イベントでの再適用

ブラウザによっては `<audio>` の内部状態リセット時に `playbackRate` が `1.0` に戻る場合がある。
`onPlay` コールバックで state の値を再適用することで対応。

---

## UI デザイン仕様

```
┌──────────────────────────────────────────────────────────┐
│  ▶ ━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🔊 ──── │ ⬇ Download │
│  再生速度  [0.5x] [0.75x] [●1x] [1.25x] [1.5x] [2.0x] │
└──────────────────────────────────────────────────────────┘
```

- 選択中の速度ボタン: `bg-primary text-primary-foreground`（ダークモード対応）
- 未選択ボタン: `bg-muted text-muted-foreground`
- ボタンサイズ: `h-6 px-2 text-xs`（コンパクト）
- `cn()` ユーティリティで条件付きクラス適用（既存パターンを踏襲）

---

## テスト確認項目

- [ ] 各速度ボタンクリックで再生速度が即座に変わること
- [ ] 速度変更後も音程が維持されること（`preservesPitch`）
- [ ] 再生中に速度を変更しても途切れないこと
- [ ] 一時停止→再開後も速度設定が維持されること
- [ ] 新しい音声をロードしても `playbackRate` state が維持されること
- [ ] ダークモードで速度ボタンの視認性が確保されること
- [ ] モバイル（iOS Safari, Chrome Android）で正常動作すること
- [ ] 選択中のボタンのハイライトが正しいこと

---

## 実装の注意点

1. **import の `useRef` 追加を忘れないこと** — 既存 import に `useRef` を追加
2. **`cn()` は既にインポート済み** — `web/src/lib/utils.ts` から
3. **`PLAYBACK_RATES` は定数としてコンポーネント外に定義可能** — だがコンポーネント内でも問題なし
4. **`type="button"` を明示** — form 内で submit されないように

---

*実装計画書作成完了: 2026-02-11*
