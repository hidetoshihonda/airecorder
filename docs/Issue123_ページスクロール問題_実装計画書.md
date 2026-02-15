# Issue #123: 文字起こしが長くなるとページ全体がスクロールしてしまう — 実装計画書

## 概要

Flexbox レイアウトチェーンの `min-height: auto` 問題を修正し、ページ全体のスクロールを防止する。録音コントロール・タブは常に画面上部に固定表示し、コンテンツエリアのみが内部スクロールするようにする。

---

## 修正対象ファイル

| # | ファイル | 変更内容 | Phase |
|---|---------|---------|-------|
| 1 | `web/src/app/page.tsx` | Page container に `overflow-hidden` 追加 | P0 |
| 2 | `web/src/app/page.tsx` | Content wrapper に `min-h-0` 追加 | P0 |
| 3 | `web/src/app/layout.tsx` | `main` に `min-h-0 overflow-hidden` 追加 | P1 |
| 4 | `web/src/components/AICuesPanel.tsx` | インライン `maxHeight` 削除 + flex 統一 | P2 |

---

## 詳細変更内容

### 変更 1: Page container に `overflow-hidden` 追加

**ファイル**: `web/src/app/page.tsx` L728

```tsx
// Before
"mx-auto flex h-[calc(100dvh-56px)] px-4 py-2 sm:px-6 lg:px-8",

// After
"mx-auto flex h-[calc(100dvh-56px)] overflow-hidden px-4 py-2 sm:px-6 lg:px-8",
```

**理由**: 固定高さコンテナからのオーバーフローを防止し、ページレベルのスクロールを遮断する。

---

### 変更 2: Content wrapper に `min-h-0` 追加

**ファイル**: `web/src/app/page.tsx` L731

```tsx
// Before
<div className="flex min-w-0 flex-1 flex-col">

// After
<div className="flex min-w-0 min-h-0 flex-1 flex-col">
```

**理由**: Flexbox の `min-height: auto` デフォルトを上書きし、flex item がコンテンツサイズを超えて拡大することを防止。これにより子要素の `overflow-y-auto` が正しく機能する。

---

### 変更 3: layout.tsx の `main` に防御的 overflow 制御

**ファイル**: `web/src/app/layout.tsx` L73

```tsx
// Before
<main className="flex-1">{children}</main>

// After
<main className="min-h-0 flex-1 overflow-hidden">{children}</main>
```

**理由**: 全ページ共通の防御層。ページコンテンツの overflow がルートレベルに伝播することを防止。

---

### 変更 4: AICuesPanel のインライン maxHeight 削除

**ファイル**: `web/src/components/AICuesPanel.tsx`

#### 4-A: パネルコンテナに `h-full min-h-0` 追加（L170-174付近）

```tsx
// Before
<div
  className={cn(
    "flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    "dark:border-gray-700 dark:bg-gray-800",
    "lg:w-70 xl:w-80"
  )}
>

// After
<div
  className={cn(
    "flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    "dark:border-gray-700 dark:bg-gray-800",
    "lg:w-70 xl:w-80"
  )}
>
```

#### 4-B: Cue List のインライン maxHeight 削除（L203-206付近）

```tsx
// Before
<div
  ref={scrollRef}
  className="flex-1 space-y-2 overflow-y-auto p-3"
  style={{ maxHeight: "calc(100vh - 200px)" }}
>

// After
<div
  ref={scrollRef}
  className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
>
```

**理由**: flex チェーンが正しく高さを制約するようになったため、インラインの `maxHeight` ワークアラウンドを削除し、純粋な flex レイアウトに統一。

---

## ブランチ・PR 規約

- **ブランチ名**: `fix/issue-123-page-scroll`
- **コミットメッセージ**: `fix: prevent page-level scrolling when transcription grows (Issue #123)`
- **PR タイトル**: `fix: ページスクロール防止 — min-h-0 + overflow-hidden 修正 (#123)`

---

## テスト手順

### ビルド確認
```bash
cd web && npm run build && npm run lint
```

### 手動テスト（必須）
1. 録音を開始し、30セグメント以上話す
2. ページ全体がスクロール**しない**ことを確認
3. 文字起こしエリアのみが内部スクロールすることを確認
4. 録音コントロール（停止ボタン）が常に画面上部に見えること
5. タブ切り替えが常にアクセス可能であること
6. 翻訳タブ・議事録タブでも同様にコンテンツのみスクロール
7. AI Cues 有効時、サイドパネルも独立スクロール
8. モバイル幅でもページスクロールが発生しないこと

---

## 見積り

| 工程 | 時間 |
|------|------|
| コード修正 | 10分 |
| ビルド・lint | 3分 |
| 手動テスト | 10分 |
| PR・CI・マージ | 5分 |
| **合計** | **約30分** |
