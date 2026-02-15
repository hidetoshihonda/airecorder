# Issue #122: リアルタイム翻訳の表示行数を5行に固定する — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: リアルタイム翻訳の「recent」モードで `getRecentSentences` は直近5文を返すが、翻訳テキストの表示エリアの**高さ**が固定されていないため、文の長さに応じて表示領域が伸縮しレイアウトが不安定になる
- **影響範囲**: リアルタイム翻訳を使用するすべてのユーザー（100%）
- **修正の緊急度**: 🟡 P2 — UX品質の問題。機能的には動作するが視覚的に不安定

---

## 2. アーキテクチャ概観

### 2.1 翻訳データフロー

```
[Speech SDK / API] → translatedSegments → translatedFullText
                                          + interimTranslation
                                          → displayTranslation (useMemo)
                                              ↓
                  translationDisplayMode === "recent"
                  ? getRecentSentences(displayTranslation, 5)  ← ★ 問題箇所
                  : displayTranslation
                                              ↓
                          <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4">
                              {表示テキスト}                   ← ★ 高さ不定
                          </div>
```

### 2.2 表示モード制御（Issue #105）

| モード | state値 | 表示内容 | 表示エリア高さ |
|--------|---------|---------|--------------|
| recent | `"recent"` | 直近5文（`getRecentSentences`） | **不定**（★問題） |
| full | `"full"` | 全文（`displayTranslation`） | flex-1 overflow-y-auto（正常） |
| 録音停止後 | — | 全文表示 | flex-1 overflow-y-auto（正常） |

---

## 3. 重大バグ分析 🔴

### BUG-1: 翻訳表示エリアの高さが不安定

**場所**: [page.tsx](web/src/app/page.tsx#L1119-L1122)

**コード**:
```tsx
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {showRecordingUI && translationDisplayMode === "recent"
    ? getRecentSentences(displayTranslation, 5)
    : displayTranslation}
</div>
```

**問題**: `getRecentSentences` は直近5文のテキストを返すが、各文の長さは可変。1文が短い場合（3語程度）は表示領域が小さく、1文が長い場合（50語以上の複文）は表示領域が大きくなる。結果として翻訳表示エリアの高さが文ごとに変動し、以下のUX問題を引き起こす：

1. **テキストのジャンプ**: 新しい文が追加されるたびにレイアウトが再計算され、視覚的にガタつく
2. **下部要素の位置変動**: 翻訳表示の下にあるソース原文（details）セクション、フォローボタンの位置が上下する
3. **読みにくさ**: ユーザーが読んでいる文の位置が動く

**影響**: リアルタイム翻訳中の全ユーザー。UXの安定性が低下。

**根本原因**: 表示テキストの行数（文字列としての行数）≠ CSS的な視覚上の行数。`whitespace-pre-wrap` で折り返されるため、1文でも画面幅に対して複数行にレンダリングされる。5文 ≠ 5行。

**修正方針**: 翻訳テキストの表示 `<div>` に以下を適用：
1. CSS `max-height` で表示エリアの最大高さを固定（例: 5行分 ≈ `7.5rem`）
2. `overflow-y-auto` で超過分をスクロール可能にする
3. `min-height` を設定して表示エリアの最小高さも安定させる

**重要度**: 🟡 High

---

### BUG-2: `getRecentSentences` の句読点分割が不完全

**場所**: [page.tsx](web/src/app/page.tsx#L50-L56)

**コード**:
```tsx
function getRecentSentences(text: string, count: number = 5): string {
  if (!text) return "";
  // 日本語句点(。)、英語ピリオド(.)、!?で区切り
  const sentences = text.split(/(?<=[。.!?！？])\s*/g).filter(Boolean);
  if (sentences.length <= count) return text;
  return "…" + sentences.slice(-count).join(" ");
}
```

**問題**:
1. **英語の略語問題**: "Mr.", "Dr.", "U.S.", "etc." のピリオドで誤分割される。例えば "Dr. Smith said hello." は2文に分割される
2. **数字の小数点**: "3.14" → "3." と "14" に分割される
3. **URL内のピリオド**: "https://example.com" が分割される
4. **結合文字 `" "`（スペース）の不統一**: 日本語文（句点区切り）にスペース結合は不自然

**影響**: 英語翻訳で意図しない「文」に分割され、5文表示のつもりが実質2〜3文分になる場合がある。翻訳テキスト量が安定しない一因。

**修正方針**: 行数ベースのCSS制御をメインソリューションとし、`getRecentSentences` は補助的に残す。テキスト分割の精度改善は P2 で対応可能。

**重要度**: 🟡 Medium

---

## 4. 設計上の問題 🟡

### DESIGN-1: 「5行」の定義が曖昧

Issue テキストでは「5行（5文）」と書かれているが、以下の2つの解釈がある：

| 解釈 | 意味 | 実装方法 |
|------|------|---------|
| A: 5文 | 文（sentence）の数を5つに限定 | `getRecentSentences` で対応済み |
| B: 5行 | 画面上の表示行数を5行に固定 | CSS `max-height` + `line-height` で制御 |

**現状**: 解釈Aのみ実装済み。しかし Issue の期待動作「表示エリアの高さが安定して固定される」は**解釈B**を求めている。

**推奨**: **A + B の両方を実装**。
- `getRecentSentences(text, 5)` でテキスト量を制限（Aは維持）
- CSS で表示エリアの `max-height` を5行分に固定（B を追加）

### ✅ Good: Issue #105 の全文/最新切り替え設計

`translationDisplayMode` state による `"recent"` / `"full"` の切り替えは良い設計。修正は `"recent"` モード時のCSSのみに影響し、`"full"` モードや録音停止後の表示は影響なし。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #122 (5行固定) ──→ Issue #105 (翻訳表示モード) [同じUI要素]
  └─ #105 の recent/full トグルと連動。recent 時のみ5行制限が適用される

Issue #122 ──→ Issue #123 (ページスクロール) [修正済み]
  └─ #123 の overflow-hidden 修正により、翻訳タブの flex チェーンが正常化

Issue #122 ──→ Issue #33 (セグメント差分翻訳) [getRecentSentences 由来]
  └─ getRecentSentences は #33 で導入された関数
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| getRecentSentences | 正規表現の分割精度 | 略語・小数点で誤分割 | CSS 高さ制御でカバー |
| 翻訳表示 `<div>` | Tailwind CSS line-height | フォントサイズ変更で行数ずれ | rem 単位で安定値を設定 |
| translationDisplayMode | Issue #105 トグル | `"full"` 時は制限不要 | 条件付きクラス適用 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Desktop) | ✅ `max-height` + `overflow-y-auto` | 低 |
| Safari (Desktop) | ✅ | 低 |
| Chrome (Mobile) | ✅ | 低 |
| Safari (iOS) | ✅ | 低 |

CSS `max-height`, `min-height`, `overflow-y-auto` はすべてのモダンブラウザで完全サポート。リスクなし。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 表示エリアの高さ固定（P0）

翻訳テキスト表示の `<div>` にCSS制約を追加：

**ファイル**: `web/src/app/page.tsx` L1119付近

```tsx
// Before
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {showRecordingUI && translationDisplayMode === "recent"
    ? getRecentSentences(displayTranslation, 5)
    : displayTranslation}
</div>

// After — recent モード時に max-height + overflow-y-auto を適用
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
- Tailwind デフォルト `text-base` = `font-size: 1rem`, `line-height: 1.5rem`
- 5行 × 1.5rem = 7.5rem（`max-h-[7.5rem]`）
- `min-h-[7.5rem]` で高さの最小値も固定し、文が少ない時もエリアサイズが安定

### Phase 2: 改善検討（P2）

- `getRecentSentences` の分割精度改善（略語・小数点対応）
- 翻訳テキストが5文未満の場合のプレースホルダー表示

---

## 8. テスト戦略

### 手動テスト

| # | テストシナリオ | 期待動作 |
|---|--------------|---------|
| 1 | リアルタイム翻訳で10文以上話す（recent モード） | 翻訳エリアの高さが一定で安定 |
| 2 | 1文だけ話した状態 | min-height により最小高さが確保 |
| 3 | 全文表示モードに切り替え | max-height 制限なし、全文表示 |
| 4 | 録音停止後の翻訳表示 | 全文表示（高さ制限なし） |
| 5 | 長い1文（50語以上）を翻訳 | 7.5rem を超えた分はスクロール可能 |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | page.tsx: 翻訳表示 div に max-h/min-h 追加 | 5分 | page.tsx のみ |
| 2 | ビルド・lint 確認 | 3分 | — |
| 3 | PR 作成 → CI → マージ | 5分 | — |
| **合計** | | **13分** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| min-height でコンテンツ少量時に無駄な空白 | 中 | 低 | 翻訳テキストがない場合は別UIなので影響なし |
| フォントサイズ変更で行数がずれる | 低 | 低 | text-base (1rem) は固定使用 |
| スクロールバーの見た目 | 低 | 低 | overflow-y-auto は必要時のみ表示 |

---

## 11. 結論

### 最大の問題点
翻訳表示 `<div>` にCSS高さ制約がないため、`getRecentSentences` で5文に制限しても視覚上の表示行数が安定しない。

### 推奨する修正順序
1. **P0**: `max-h-[7.5rem] min-h-[7.5rem] overflow-y-auto` を recent モード時に適用
2. **P2**: `getRecentSentences` の分割精度改善

### 判定: ✅ `GO`
1箇所のCSS追加で完結。リスク極めて低い。
