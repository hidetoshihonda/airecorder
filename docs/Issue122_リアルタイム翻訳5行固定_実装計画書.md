# Issue #122: リアルタイム翻訳の表示行数を5行に固定する — 実装計画書

## 概要

リアルタイム翻訳の「recent」表示モード時に、翻訳テキスト表示エリアの高さを5行分に固定し、UIの安定性を向上させる。

---

## 修正対象ファイル

| # | ファイル | 変更内容 |
|---|---------|---------|
| 1 | `web/src/app/page.tsx` | 翻訳表示 `<div>` に条件付き `max-h` / `min-h` / `overflow-y-auto` 追加 |

---

## 詳細変更内容

### 変更 1: 翻訳テキスト表示エリアの高さ固定

**ファイル**: `web/src/app/page.tsx` L1119付近

```tsx
// Before
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {showRecordingUI && translationDisplayMode === "recent"
    ? getRecentSentences(displayTranslation, 5)
    : displayTranslation}
</div>

// After
<div className={cn(
  "whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800",
  showRecordingUI && translationDisplayMode === "recent"
    && "max-h-[7.5rem] min-h-[7.5rem] overflow-y-auto"
)}>
  {showRecordingUI && translationDisplayMode === "recent"
    ? getRecentSentences(displayTranslation, 5)
    : displayTranslation}
</div>
```

**計算根拠**:
- `text-base` = `font-size: 1rem`, `line-height: 1.5rem`
- 5行 × 1.5rem = **7.5rem**
- `min-h-[7.5rem]`: 文が少ない時もエリアサイズを確保
- `max-h-[7.5rem]`: 文が長い時も5行分に制限
- `overflow-y-auto`: 超過分はスクロール可能

**適用条件**: `showRecordingUI && translationDisplayMode === "recent"` の場合のみ
- 全文表示モード（`"full"`）→ 制限なし
- 録音停止後 → 制限なし

---

## ブランチ・PR 規約

- **ブランチ名**: `fix/issue-122-translation-5-lines`
- **コミットメッセージ**: `fix: fix translation display height to 5 lines in recent mode (Issue #122)`
- **PR タイトル**: `fix: リアルタイム翻訳の表示エリアを5行固定 (#122)`

---

## テスト手順

### ビルド確認
```bash
cd web && npm run build && npm run lint
```

### 手動テスト（必須）
1. リアルタイム翻訳を有効にして録音開始
2. 10文以上話して翻訳テキストが表示される
3. 翻訳エリアの高さが一定（5行分）で安定していること
4. 長文の場合、エリア内でスクロール可能なこと
5. 全文表示トグルをONにすると高さ制限が解除されること
6. 録音停止後は高さ制限なしで全文表示されること

---

## 見積り

| 工程 | 時間 |
|------|------|
| コード修正 | 5分 |
| ビルド・lint | 3分 |
| PR・CI・マージ | 5分 |
| **合計** | **約13分** |
