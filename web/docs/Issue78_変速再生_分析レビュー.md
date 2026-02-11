# Issue #78: 録音の変速再生（0.5x〜2.0x） — 分析レビュー

> 作成日: 2026-02-11
> 対象 Issue: #78 (G-08)
> Phase: 1（クイックウィン）
> 工数見積: S（1-2日）

---

## 1. エグゼクティブサマリー

- **問題の本質**: 録音再生時に再生速度を変更する手段が一切存在しない。長時間録音の確認作業が非効率。
- **影響範囲**: 録音を再生する全ユーザー（100%）。特に1時間超の会議録音を確認するユーザーへの影響大。
- **修正の緊急度**: **Medium** — 機能追加であり既存機能の破壊はない。ただし Phase 1 最優先（最小工数で最大効果）。

---

## 2. アーキテクチャ概観

### 2.1 音声再生の現状コンポーネント構成

```
音声再生が存在する画面
├── 録音詳細ページ (web/src/app/recording/page.tsx)
│   └── <audio controls> タグ (L656)
│       ├── src = SAS付きaudioUrl (state)
│       ├── ブラウザネイティブコントロール使用
│       └── ダウンロードボタン (カスタム)
│
└── 履歴ページ (web/src/app/history/page.tsx)
    └── window.open(playableUrl) (L68)
        └── 別タブでブラウザのデフォルト再生
```

### 2.2 データフロー

```
Azure Blob Storage
  │
  ▼ (SAS URL取得)
blobApi.getPlayableUrl(recording.audioUrl)
  │
  ▼
audioUrl state (string)
  │
  ▼
<audio controls src={audioUrl}>  ← ここに再生速度制御を追加
```

### 2.3 現行の再生方式

| 画面 | 再生方式 | カスタムUI | 速度制御 |
|------|---------|-----------|---------|
| 録音詳細 (`/recording`) | `<audio controls>` | ダウンロードボタンのみ | ❌ なし |
| 履歴一覧 (`/history`) | `window.open()` 別タブ | なし | ❌ なし |

---

## 3. 重大バグ分析 🔴

本 Issue は機能追加であり、既存バグは含まれない。ただし以下の設計上の留意点がある。

### ISSUE-1: `<audio controls>` のブラウザ依存性
**場所**: `web/src/app/recording/page.tsx` L656
**コード**:
```tsx
<audio controls className="flex-1" src={audioUrl}>
  {t("audioNotSupported")}
</audio>
```
**問題**: ブラウザネイティブの `<audio controls>` は再生速度の UI を提供しない（Chrome は右クリックメニューに速度変更が存在するが、モバイル Safari や Firefox では不可）。
**影響**: 現状ではどのブラウザでもUI上から速度変更ができない。
**根本原因**: ネイティブ `<audio>` コントロールに再生速度UIが含まれていない仕様。
**修正方針**: `<audio>` 要素への `ref` 取得と `playbackRate` プロパティの制御、および速度選択UIの追加。

---

## 4. 設計上の問題 🟡

### 4.1 ✅ Good: SAS URL による安全な再生
`blobApi.getPlayableUrl()` で SAS トークン付き URL を取得してから `<audio src>` に渡す設計は正しい。Issue #5 で修正済み。

### 4.2 ✅ Good: 単一のオーディオプレイヤー
録音詳細ページの `<audio>` タグは1箇所のみに統合されている（以前の重複問題は解消済み）。

### 4.3 ⚠️ 改善推奨: カスタムオーディオプレイヤーコンポーネントの不在
現在、`<audio controls>` をそのまま JSX に埋め込んでいる。変速再生・ブックマーク（#86）・テキスト連動（#83）等の将来機能を考慮すると、**カスタムオーディオプレイヤーコンポーネント**の導入が望ましい。

### 4.4 ⚠️ 履歴ページの再生方式
履歴ページでは `window.open()` で別タブ再生しており、アプリ内プレイヤーではない。変速再生は録音詳細ページでのみ対応すべき（スコープ限定）。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #78 (変速再生)
  ├──→ Issue #86 (ハイライト/ブックマーク) [前提: カスタムプレイヤー化すれば#86の実装も容易に]
  ├──→ Issue #83 (テキスト位置と音声再生の連動) [前提: audio ref の取得が必要]
  └──→ Issue #80 (再生速度UIの再生スタイルの一貫性)
```

- **ブロッカー**: なし。独立して実装可能。
- **#86 との相乗効果**: カスタムプレイヤーコンポーネントを本 Issue で導入すれば、#86 の実装が大幅に簡略化される。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `HTMLAudioElement.playbackRate` | ブラウザ Web API | 低 | 全モダンブラウザ対応 |
| `HTMLAudioElement.preservesPitch` | ブラウザ Web API | 低 | Chrome/Firefox/Safari 対応済み |
| SAS URL の有効期限 | Azure Blob Storage | 低 | 既存実装で対応済み |

### 5.3 他 Issue/機能との相互作用

| Issue | 影響 | 詳細 |
|-------|------|------|
| #86 ハイライト/ブックマーク | ✅ 正の影響 | カスタムプレイヤー化で基盤を共有 |
| #83 テキスト音声連動 | ✅ 正の影響 | `audioRef` のパターンを再利用 |
| #80 タグ付け | ❌ 影響なし | 無関係 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Desktop) | ✅ `playbackRate` + `preservesPitch` 完全対応 | なし |
| Firefox (Desktop) | ✅ `playbackRate` + `preservesPitch` 完全対応 | なし |
| Safari (Desktop) | ✅ `playbackRate` 対応、`preservesPitch` は `webkitPreservesPitch` | プレフィックスが必要 |
| Chrome (Android) | ✅ 完全対応 | なし |
| Safari (iOS) | ⚠️ `playbackRate` 対応だが 0.5x 未満で不安定な場合あり | 0.5x を下限に設定 |
| Edge | ✅ Chrome と同等 | なし |

**Safari `preservesPitch` 互換性対策**:
```typescript
const audio = audioRef.current;
if ('preservesPitch' in audio) {
  audio.preservesPitch = true;
} else if ('webkitPreservesPitch' in audio) {
  (audio as any).webkitPreservesPitch = true;
}
```

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0） — 該当なし

### Phase 2: 変速再生機能の実装（P1）

#### 修正箇所一覧

| # | ファイル | 変更内容 |
|---|---------|---------|
| 1 | `web/src/app/recording/page.tsx` | `<audio>` に `ref` を追加、速度選択UIを追加 |
| 2 | `web/messages/ja.json` | 速度関連の i18n キーを追加 |
| 3 | `web/messages/en.json` | 同上（英語） |
| 4 | `web/messages/es.json` | 同上（スペイン語） |

#### 7.1 録音詳細ページへの変速再生UI追加

**変更箇所**: `web/src/app/recording/page.tsx`

**実装方針**:

1. `useRef<HTMLAudioElement>` で audio 要素への参照を取得
2. `playbackRate` state を追加（デフォルト: 1.0）
3. 速度ボタン群（0.5x / 0.75x / 1.0x / 1.25x / 1.5x / 2.0x）を audio の右側 or 下に配置
4. `preservesPitch = true` で音程を維持

**コード例**:

```tsx
// State 追加
const audioRef = useRef<HTMLAudioElement>(null);
const [playbackRate, setPlaybackRate] = useState(1.0);

// 速度変更ハンドラ
const handlePlaybackRateChange = (rate: number) => {
  setPlaybackRate(rate);
  if (audioRef.current) {
    audioRef.current.playbackRate = rate;
    // Safari 互換性
    if ('preservesPitch' in audioRef.current) {
      audioRef.current.preservesPitch = true;
    } else if ('webkitPreservesPitch' in audioRef.current) {
      (audioRef.current as any).webkitPreservesPitch = true;
    }
  }
};

// 速度選択肢
const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// JSX (既存の <audio> を置き換え)
<div className="flex flex-col gap-2">
  <div className="flex items-center gap-4">
    <audio 
      ref={audioRef}
      controls 
      className="flex-1" 
      src={audioUrl}
      onPlay={() => {
        // audio要素の再生開始時にplaybackRateを適用
        if (audioRef.current) {
          audioRef.current.playbackRate = playbackRate;
        }
      }}
    >
      {t("audioNotSupported")}
    </audio>
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <Download className="mr-2 h-4 w-4" />
      {t("download")}
    </Button>
  </div>
  <div className="flex items-center gap-1">
    <span className="text-xs text-gray-500 mr-2">{t("playbackSpeed")}</span>
    {PLAYBACK_RATES.map((rate) => (
      <Button
        key={rate}
        variant={playbackRate === rate ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => handlePlaybackRateChange(rate)}
      >
        {rate}x
      </Button>
    ))}
  </div>
</div>
```

#### 7.2 i18n キーの追加

**ja.json** (`RecordingDetail` セクション):
```json
"playbackSpeed": "再生速度"
```

**en.json**:
```json
"playbackSpeed": "Speed"
```

**es.json**:
```json
"playbackSpeed": "Velocidad"
```

### Phase 3: 堅牢性強化（P2）

#### 3.1 速度設定の永続化（オプション）
- `localStorage` に最後に選択した速度を保存
- 次回再生時に復元
- UserSettings への追加は不要（ローカルのみで十分）

#### 3.2 カスタムオーディオプレイヤーコンポーネント化（将来）
- `AudioPlayer` コンポーネントを `web/src/components/ui/audio-player.tsx` として切り出し
- #86（ブックマーク）、#83（テキスト連動）で再利用
- 今回は録音詳細ページ内のインライン実装で十分

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 期待値 |
|-------------|--------|
| 初期状態 | `playbackRate = 1.0` |
| 0.5x ボタンクリック | `audioRef.current.playbackRate === 0.5` |
| 2.0x ボタンクリック | `audioRef.current.playbackRate === 2.0` |
| 速度変更 → 一時停止 → 再開 | 速度が維持される |
| 速度変更 → 別の音声ロード | 新しい音声にも速度が適用される |

### 手動テスト

| ブラウザ | テスト項目 | 確認ポイント |
|---------|-----------|-------------|
| Chrome Desktop | 全速度段階 | 音程が維持されるか |
| Safari Desktop | `webkitPreservesPitch` | フォールバックが効くか |
| Chrome Android | タッチ操作 | ボタンが押しやすいか |
| Safari iOS | 全速度段階 | 0.5x で安定再生されるか |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `recording/page.tsx` に `audioRef` + `playbackRate` state 追加 | 15分 | 録音詳細ページ |
| 2 | 速度変更ハンドラ実装（Safari互換含む） | 15分 | 同上 |
| 3 | 速度選択UI（ボタン群）を `<audio>` 下に追加 | 30分 | 同上 |
| 4 | i18n キー追加（3言語） | 10分 | messages/*.json |
| 5 | 手動テスト（Chrome / Safari / Mobile） | 30分 | — |
| **合計** | | **約1.5〜2時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Safari の `preservesPitch` 非対応 | 低 | 中 | `webkitPreservesPitch` フォールバック実装 |
| iOS Safari で極端な速度が不安定 | 低 | 低 | 0.5x〜2.0x の範囲に制限 |
| `onPlay` イベントで `playbackRate` リセット | 中 | 低 | `onPlay` コールバックで再適用 |
| 将来の機能（#86, #83）との統合困難 | 低 | 中 | 現時点はインライン、必要時にコンポーネント切り出し |

---

## 11. 結論

- **最大の問題点**: 再生速度を変更するUIが完全に不在。HTMLネイティブ `<audio>` では提供されない。
- **推奨する修正順序**: 単一ステップで完了可能（recording/page.tsx + i18n のみ）
- **他 Issue への影響**: #86（ブックマーク）、#83（テキスト連動）の基盤として `audioRef` パターンが再利用される。
- **判定**: **GO** ✅ — 最小工数（約2時間）で完了。新規ファイル作成不要。既存ページへの追加のみ。ブラウザ互換性リスクも極めて低い。

---

*レビュー完了: 2026-02-11*
