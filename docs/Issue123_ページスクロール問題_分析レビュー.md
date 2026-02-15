# Issue #123: 文字起こしが長くなるとページ全体がスクロールしてしまう — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: Flexbox レイアウトチェーンの `min-height: auto` 問題と `overflow` 制御の欠落により、コンテンツが増えるとページ全体がスクロールしてしまう
- **影響範囲**: 録音画面の全ユーザー（100%）。文字起こしが数十セグメント以上になると確実に発生
- **修正の緊急度**: 🔴 **P1 Critical** — 録音中に停止ボタンにアクセスできなくなるため、録音操作の基本体験を破壊する

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係図

```
layout.tsx
├── <div className="flex min-h-screen flex-col">
│   ├── <Header />                           ← 56px (sticky top-0)
│   ├── <main className="flex-1">            ← ❌ overflow制御なし
│   │   └── page.tsx (HomePage)
│   │       └── <div h-[calc(100dvh-56px)]>  ← ❌ overflow-hidden なし
│   │           ├── <div flex-1 flex-col>     ← ❌ min-h-0 なし（★根本原因）
│   │           │   ├── Controls Bar (flex-none) ✅
│   │           │   └── <Tabs flex-1 min-h-0>    ✅
│   │           │       ├── TabsList (flex-none)  ✅
│   │           │       └── TabsContent (flex-1 min-h-0) ✅
│   │           │           └── Card (flex-1 min-h-0) ✅
│   │           │               ├── CardHeader (flex-none) ✅
│   │           │               └── CardContent (flex-1 min-h-0 overflow-hidden) ✅
│   │           │                   └── TranscriptView (flex-1 overflow-y-auto) ✅
│   │           └── [AICuesPanel] (flex-none, lg:flex)
│   └── <Footer />                           ← ページスクロール時に到達可能
```

### 2.2 Flex チェーンの高さ制約フロー

```
Viewport (100dvh)
  ├── Header: 56px (sticky)
  └── main (flex-1, 高さ制約なし)
       └── Page container: h-[calc(100dvh-56px)] = 固定高さ
            └── Content wrapper: flex-1 (min-h: auto ← ★ここで破綻)
                 ├── Controls: flex-none ← 固定
                 └── Tabs: flex-1 min-h-0 ← 正しい
                      └── ... 以下正しく設定されている
```

### 2.3 問題発生メカニズム

```
[正常時]
Page container (500px) → Content wrapper (500px) → Controls (50px) + Tabs (450px)

[コンテンツ増加時]
Page container (500px) → Content wrapper (min-h: auto = 800px!) ← 親より大きくなる
  → overflow: visible (デフォルト) で親からはみ出す
  → body レベルのスクロールが発生
  → ページ全体がスクロール
```

---

## 3. 重大バグ分析 🔴

### BUG-1: Content wrapper に `min-h-0` が欠落（★根本原因）

**場所**: [page.tsx](web/src/app/page.tsx#L731)

**コード**:
```tsx
<div className="flex min-w-0 flex-1 flex-col">
```

**問題**: CSS Flexbox では flex item の `min-height` のデフォルト値は `auto`（コンテンツサイズ）。`flex-1` を指定しても、コンテンツがコンテナより大きい場合、flex item はコンテンツサイズまで拡大してしまう。`min-h-0` を指定しないと、この div は子要素のコンテンツ量に応じて無限に成長する。

**影響**: 文字起こしセグメントが画面高さを超えた時点で、この div の高さが親コンテナ `h-[calc(100dvh-56px)]` を超え、ページ全体がスクロール対象になる。全ユーザーの100%に影響。

**根本原因**: Tabs 以下の flex チェーンには `min-h-0` が正しく設定されているが、1つ上の wrapper にのみ設定が漏れている。Issue #89 で AI Cues 対応として `<div className="flex min-w-0 flex-1 flex-col">` を追加した際に `min-h-0` が設定されなかった。

**修正方針**:
```tsx
// Before
<div className="flex min-w-0 flex-1 flex-col">

// After
<div className="flex min-w-0 min-h-0 flex-1 flex-col">
```

**重要度**: 🔴 Critical

---

### BUG-2: Page container に `overflow-hidden` が欠落

**場所**: [page.tsx](web/src/app/page.tsx#L726-L730)

**コード**:
```tsx
<div className={cn(
  "mx-auto flex h-[calc(100dvh-56px)] px-4 py-2 sm:px-6 lg:px-8",
  enableAICues && showRecordingUI
    ? "max-w-7xl flex-row gap-4"
    : "max-w-5xl flex-col"
)}>
```

**問題**: `h-[calc(100dvh-56px)]` は固定高さを設定するが、CSS の `overflow` デフォルト値は `visible`。コンテンツが溢れた場合、視覚的にはみ出し、上位の `body` レベルでスクロールが発生する。

**影響**: BUG-1 と組み合わさって、overflow がページレベルに伝播する。`overflow-hidden` がないため、BUG-1 を修正しても完全な安全性が保証されない。

**修正方針**:
```tsx
// Before
"mx-auto flex h-[calc(100dvh-56px)] px-4 py-2 sm:px-6 lg:px-8",

// After
"mx-auto flex h-[calc(100dvh-56px)] overflow-hidden px-4 py-2 sm:px-6 lg:px-8",
```

**重要度**: 🔴 Critical（BUG-1と合わせて修正必須）

---

### BUG-3: layout.tsx の `main` 要素に overflow 制御なし

**場所**: [layout.tsx](web/src/app/layout.tsx#L73)

**コード**:
```tsx
<main className="flex-1">{children}</main>
```

**問題**: `main` 要素は `flex-1` のみで、`overflow-hidden` も `min-h-0` もない。ページ内コンテンツがオーバーフローした場合、`main` が拡大し、親の `div.flex.min-h-screen.flex-col` の `min-h-screen` により画面高さを超えたレイアウトが許容される。

**影響**: BUG-1, BUG-2 を修正すれば直接の影響はないが、防御層として不十分。他のページ（history, settings）にも同様のリスクが潜在する。

**修正方針**:
```tsx
// Before
<main className="flex-1">{children}</main>

// After
<main className="flex-1 overflow-hidden">{children}</main>
```

**重要度**: 🟡 High（防御的修正、他ページへの波及防止）

---

## 4. 設計上の問題 🟡

### DESIGN-1: AICuesPanel の高さ制御がインラインスタイル依存

**場所**: [AICuesPanel.tsx](web/src/components/AICuesPanel.tsx#L205)

```tsx
<div
  ref={scrollRef}
  className="flex-1 space-y-2 overflow-y-auto p-3"
  style={{ maxHeight: "calc(100vh - 200px)" }}
>
```

`maxHeight` をインラインスタイルで指定しているのは、親の flex チェーンが正しく高さを制約しないための回避策。BUG-1/2 を修正し、さらにパネル自体に `h-full min-h-0` を追加すれば、`maxHeight` は不要になり、純粋な flex レイアウトに統一できる。

**重要度**: 🟡 Medium（技術的負債）

---

### DESIGN-2: Header 高さの 56px がマジックナンバー

`h-[calc(100dvh-56px)]` の `56px` は Header の `py-3` + コンテンツ高さからの推定値。Header の高さが変わると計算がずれる。CSS 変数やレイアウトの構造的な解決（`h-dvh overflow-hidden` を最外部に適用し、flex で自動分配）が望ましい。

**重要度**: 🟡 Low（現時点で問題は起きていないが、保守性リスク）

---

### ✅ Good: Tabs 以下の flex チェーン設計

Tabs → TabsContent → Card → CardContent → TranscriptView の flex チェーンは `min-h-0` + `flex-1` + `overflow-hidden` / `overflow-y-auto` が一貫して適用されている。TranscriptView の `fillHeight` プロップによる高さ自動調整も良い設計。唯一の問題は、このチェーンの最上位 wrapper に `min-h-0` が抜けていただけ。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #123 (ページスクロール) ──→ Issue #4 (自動追従) [同じ領域]
  └─ #123 を修正すると #4 の自動追従が正しく動作するようになる（改善）

Issue #123 ──→ Issue #89 (AI Cues) [BUG-1 の原因]
  └─ #89 で追加された content wrapper に min-h-0 が設定されなかった

Issue #123 ──→ Issue #122 (翻訳表示行数5行) [同じタブ内]
  └─ 翻訳タブ内のスクロールは #123 修正で正常化される
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| page.tsx (content wrapper) | layout.tsx (main) | main の overflow 制御不足 | main に overflow-hidden 追加 |
| AICuesPanel (flex-row mode) | page.tsx (container) | flex-row 時の高さ制約 | overflow-hidden で統一 |
| TranscriptView (fillHeight) | CardContent (overflow-hidden) | 正しく動作（影響なし） | — |
| Header (sticky) | page container | ページスクロールで意味をなさない | ページスクロール自体を防止 |

### 5.3 他 Issue/機能との相互作用

- **Issue #4 (自動追従)**: TranscriptView の auto-scroll は `overflow-y-auto` コンテナ内で動作する。#123 が修正されれば、スクロールコンテナが正しく機能し、auto-follow も正常動作する。
- **Issue #89 (AI Cues)**: `enableAICues && showRecordingUI` 時に flex-row レイアウトに切り替わるが、同じ `overflow-hidden` + `min-h-0` 修正で対応可能。
- **Issue #105 (翻訳表示モード)**: 翻訳タブの recent/full 切り替えは #123 修正後も影響なし。

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Desktop) | ✅ `100dvh` 対応 | 低 |
| Safari (Desktop) | ✅ `100dvh` 対応 | 低 |
| Firefox (Desktop) | ✅ `100dvh` 対応 | 低 |
| Chrome (Mobile) | ✅ `dvh` でアドレスバー対応 | 低 |
| Safari (iOS) | ⚠️ `dvh` は iOS 15.4+ | Safari 15.3以下で高さ計算が不正確になる可能性（ごく少数） |
| Edge (Desktop) | ✅ `100dvh` 対応 | 低 |

**Note**: `overflow-hidden` と `min-h-0` はすべてのモダンブラウザで完全サポート。リスクなし。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### 修正 1-A: Content wrapper に `min-h-0` を追加

**ファイル**: `web/src/app/page.tsx` L731

```tsx
// Before
<div className="flex min-w-0 flex-1 flex-col">

// After
<div className="flex min-w-0 min-h-0 flex-1 flex-col">
```

#### 修正 1-B: Page container に `overflow-hidden` を追加

**ファイル**: `web/src/app/page.tsx` L728

```tsx
// Before
"mx-auto flex h-[calc(100dvh-56px)] px-4 py-2 sm:px-6 lg:px-8",

// After
"mx-auto flex h-[calc(100dvh-56px)] overflow-hidden px-4 py-2 sm:px-6 lg:px-8",
```

### Phase 2: 防御的修正（P1）

#### 修正 2-A: layout.tsx の `main` に overflow 制御

**ファイル**: `web/src/app/layout.tsx` L73

```tsx
// Before
<main className="flex-1">{children}</main>

// After
<main className="min-h-0 flex-1 overflow-hidden">{children}</main>
```

### Phase 3: 堅牢性強化（P2）

#### 修正 3-A: AICuesPanel のインライン maxHeight を削除

**ファイル**: `web/src/components/AICuesPanel.tsx` L205

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

（AICuesPanel の親 div にも `h-full min-h-0` が必要）

#### 変更ファイル一覧

| Phase | ファイル | 変更内容 |
|-------|---------|---------|
| P0 | `web/src/app/page.tsx` | `min-h-0` 追加 + `overflow-hidden` 追加 |
| P1 | `web/src/app/layout.tsx` | `main` に `min-h-0 overflow-hidden` 追加 |
| P2 | `web/src/components/AICuesPanel.tsx` | インライン `maxHeight` 削除、flex 統一 |

---

## 8. テスト戦略

### 手動テスト

| # | テストシナリオ | 期待動作 | 確認環境 |
|---|--------------|---------|---------|
| 1 | 30セグメント以上の文字起こしを実施 | 録音コントロールバーが常に画面上部に固定表示される | Chrome Desktop |
| 2 | 録音中にページを上下スクロール操作 | ページ全体はスクロールせず、文字起こしエリアのみスクロール | Chrome Desktop |
| 3 | タブ（文字起こし/翻訳/議事録）切り替え | 常にタブバーが表示されている | Chrome Desktop |
| 4 | AI Cues有効 + 録音中 + 大量セグメント | メインエリア + サイドパネル共にそれぞれ独立スクロール | Chrome Desktop (lg+) |
| 5 | 翻訳タブで長文翻訳を表示 | 翻訳エリアのみスクロール、コントロール固定 | Chrome Desktop |
| 6 | 議事録タブで長文議事録を表示 | 議事録エリアのみスクロール | Chrome Desktop |
| 7 | 録音停止後に長い文字起こしを表示 | コンテンツエリアのみスクロール | Chrome Desktop |
| 8 | モバイル幅 (375px) で文字起こし | ページスクロールなし、コンテンツ内スクロール | Chrome DevTools |
| 9 | 自動追従ボタンの動作確認 | 手動スクロール → 追従ボタン表示 → クリックで最新へ | Chrome Desktop |

### 回帰テスト

| # | テストシナリオ | 確認ポイント |
|---|--------------|-------------|
| 1 | 設定画面の表示 | layout.tsx 変更の影響がないこと |
| 2 | 履歴画面の表示 | layout.tsx 変更の影響がないこと |
| 3 | Footer の表示 | ホーム画面以外では Footer が見えること |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | page.tsx: `min-h-0` + `overflow-hidden` 追加 | 5分 | page.tsx のみ |
| 2 | layout.tsx: `main` に防御的 overflow 制御追加 | 2分 | 全ページ |
| 3 | AICuesPanel: インライン maxHeight 削除 | 5分 | AICuesPanel のみ |
| 4 | ローカルでビルド + lint 確認 | 3分 | — |
| 5 | 手動テスト（上記マトリクス） | 10分 | — |
| 6 | PR 作成 → CI → マージ | 5分 | — |
| **合計** | | **30分** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| `overflow-hidden` により意図しないコンテンツ切れ | 低 | 中 | Dialog/Modal は Portal で描画されるため影響なし。手動テストで確認 |
| layout.tsx 変更による他ページへの影響 | 低 | 中 | 履歴・設定ページは `min-h-screen` 前提のコンテンツ量なので影響極小 |
| `min-h-0` によるコンテンツゼロ時の表示崩れ | 極低 | 低 | 空状態は固定テキスト表示のため影響なし |
| AICuesPanel の maxHeight 削除後のレイアウト崩れ | 低 | 低 | flex チェーンが正しければ問題なし。P2 で段階的に対応 |

---

## 11. 結論

### 最大の問題点
Content wrapper (`<div className="flex min-w-0 flex-1 flex-col">`) に `min-h-0` が欠落していることが根本原因。CSS Flexbox の `min-height: auto` デフォルト値により、コンテンツが増えると flex item がコンテナを超えて拡大し、ページ全体のスクロールを引き起こす。

### 推奨する修正順序
1. **P0**: `page.tsx` に `min-h-0` + `overflow-hidden` を追加（根本修正）
2. **P1**: `layout.tsx` の `main` に防御的 overflow 制御を追加
3. **P2**: `AICuesPanel` のインライン `maxHeight` を削除して flex 統一

### 他 Issue への影響サマリー
- **Issue #4** (自動追従): 改善方向。スクロールコンテナが正しく機能するようになる
- **Issue #89** (AI Cues): flex-row モードでも同修正で対応可能
- **Issue #122** (翻訳5行): 影響なし

### 判定: ✅ `GO`
修正は2クラス（2行変更 + 1行変更）で完結し、リグレッションリスクも極めて低い。即座に実装着手可能。
