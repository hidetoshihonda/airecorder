# Issue #121: スマホ版 録音詳細画面のAI補正版UI改善 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 録音詳細画面の「AI補正済み」バッジと「オリジナル / AI補正版」切り替えタブが、モバイル画面幅（~375px）でレイアウト崩れを起こし、操作しにくい
- **影響範囲**: モバイルユーザーの100%に影響（AI補正機能使用時）
- **修正の緊急度**: **P2 — Medium**（機能は動作するが UX が悪い）

## 2. アーキテクチャ概観

### 対象UI構造

```
<Card>
  <CardHeader className="flex flex-row items-center justify-between">
    ├── 左側: <div className="flex items-center gap-4">
    │   ├── <CardTitle> "文字起こし"
    │   └── {correctionStatusBadge}  ← 🟡 「AI補正済み」バッジ
    │
    └── 右側: <div className="flex items-center gap-2">
        ├── 切り替えタブ: <div className="flex rounded-lg border p-1">
        │   ├── <Button> "オリジナル"
        │   └── <Button> "AI補正版" (with Sparkles icon)
        └── コピーボタン: <Button> "コピー"
  </CardHeader>
</Card>
```

### 問題のCSS

```
CardHeader: flex flex-row items-center justify-between
  → モバイルでも横並び (flex-row) が強制
  → 左 (タイトル+バッジ) と右 (タブ+コピー) が一行に収まらない
  → はみ出し or 重なり

切り替えタブ: flex rounded-lg border p-1
  → ボタンのテキストサイズ: text-xs
  → ボタンの size: sm
  → 375px幅ではギリギリ or はみ出す

コピーボタン: gap-2
  → タブとコピーが横並びで幅を圧迫
```

## 3. 重大バグ分析 🔴

### BUG-1: CardHeader のレイアウト崩れ（High）

**場所**: `web/src/app/recording/page.tsx` L798-L799

**コード**:
```tsx
<CardHeader className="flex flex-row items-center justify-between">
  <div className="flex items-center gap-4">
```

**問題**: 
- `flex-row` がモバイルでも適用され、タイトル行とアクション行が横並び
- 375px 幅の場合、左側（タイトル 約80px + バッジ 約100px）+ 右側（タブ 約200px + コピー 約80px）= 約460px が必要
- 画面幅不足で要素が縮小 or オーバーフロー

**影響**: タブやコピーボタンが縮小されて文字が読めない、またはタッチターゲットが小さくなり誤操作しやすい

**根本原因**: レスポンシブ対応のブレークポイントが設定されていない

**修正方針**: 
- モバイル: flex-col（縦並び） → sm以上: flex-row（横並び）
- バッジとタブのサイズ最適化

### BUG-2: 切り替えタブのタッチターゲットが小さい（Medium）

**場所**: `web/src/app/recording/page.tsx` L803-L818

**コード**:
```tsx
<Button
  variant={transcriptView === "original" ? "secondary" : "ghost"}
  size="sm"
  onClick={() => setTranscriptView("original")}
  className="text-xs"
>
```

**問題**: `size="sm"` + `text-xs` でモバイルのタッチターゲットが推奨 44px × 44px を下回る可能性

**影響**: 指の太いユーザーが誤タップしやすい

**修正方針**: モバイルでのタッチターゲットサイズを確保（`min-h-[44px]` の追加、または size の条件分岐）

## 4. 設計上の問題 🟡

### 4.1 レスポンシブ設計の欠如
- `recording/page.tsx` の CardHeader が全てデスクトップ前提の `flex-row`
- Tailwind の `sm:` / `md:` プレフィックスが未使用
- ✅ Good: `text-xs` や `size="sm"` で小さめのUIコンポーネントを使用している

### 4.2 correctionStatusBadge の定義確認が必要

**場所**: `web/src/app/recording/page.tsx` のどこかで定義

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係
```
Issue #121 (モバイルUI) ──→ Issue #120 (話者ラベル) [なし: 独立]
Issue #121 (モバイルUI) ──→ Issue #124 (要約テンプレ) [なし: 独立]
```
→ 並行作業可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| CardHeader CSS | Tailwind CSS v4 | None | 標準ユーティリティクラス使用 |
| Button size | shadcn/ui Button | None | 標準 props 使用 |

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| iOS Safari | Tailwind CSS は互換 | Low — flexbox は全対応 |
| Android Chrome | 同上 | Low |
| デスクトップ | リグレッション確認必要 | Low — sm: 以上は既存と同じ |

## 7. 修正提案（優先順位付き）

### Phase 1: レイアウト修正（P0）

**修正箇所**: `web/src/app/recording/page.tsx`

#### 修正 A: CardHeader をレスポンシブ化

```tsx
<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  <div className="flex items-center gap-2 sm:gap-4">
    <CardTitle className="text-lg">{t("transcript")}</CardTitle>
    {correctionStatusBadge}
  </div>
  <div className="flex items-center gap-2">
    {/* 切り替えタブ + コピーボタン */}
  </div>
</CardHeader>
```

**変更点**:
- `flex-row` → `flex-col gap-3 sm:flex-row`（モバイル: 縦並び、sm以上: 横並び）
- `items-center justify-between` → `sm:items-center sm:justify-between`（sm以上のみ）
- gap-4 → `gap-2 sm:gap-4`（モバイルはコンパクトに）

#### 修正 B: 切り替えタブのモバイル最適化

```tsx
<div className="flex w-full rounded-lg border p-1 sm:w-auto">
  <Button
    variant={transcriptView === "original" ? "secondary" : "ghost"}
    size="sm"
    onClick={() => setTranscriptView("original")}
    className="flex-1 text-xs sm:flex-none"
  >
    {t("original")}
  </Button>
  <Button
    variant={transcriptView === "corrected" ? "secondary" : "ghost"}
    size="sm"
    onClick={() => setTranscriptView("corrected")}
    className="flex-1 gap-1 text-xs sm:flex-none"
  >
    <Sparkles className="h-3 w-3" />
    {t("aiCorrected")}
  </Button>
</div>
```

**変更点**:
- タブ外枠: `w-full sm:w-auto`（モバイル: 全幅、sm以上: 自動幅）
- ボタン: `flex-1 sm:flex-none`（モバイル: 均等分割、sm以上: コンテンツ幅）

**変更ファイル一覧**:
- `web/src/app/recording/page.tsx`（CardHeader + 切り替えタブの CSS 修正）

### Phase 2: 堅牢性強化（P2）
- タッチターゲットサイズの最低保証（`min-h-[44px]`）
- 長い翻訳テキストのバッジが改行する場合の処理

## 8. テスト戦略

### 手動テスト（ブラウザDevToolsレスポンシブモード）
| 画面幅 | 確認項目 | 期待結果 |
|--------|---------|---------|
| 375px (iPhone SE) | CardHeader レイアウト | 縦並び、全要素が見える |
| 375px | タブタッチ | 切り替え可能、ターゲット十分 |
| 768px (iPad) | CardHeader レイアウト | 横並びに切り替わる |
| 1024px+ | デスクトップ | 既存と同じ表示（リグレッションなし） |

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | CardHeader レスポンシブ化 | 5分 | recording/page.tsx |
| 2 | 切り替えタブのモバイル最適化 | 5分 | recording/page.tsx |
| 3 | ビルド・lint 確認 | 2分 | - |
| 4 | レスポンシブテスト（DevTools） | 10分 | - |
| **合計** | | **22分** | |

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| デスクトップ表示のリグレッション | Low | Medium | sm: プレフィックスで既存動作を保証 |
| Tailwind CSS v4 の互換性 | Very Low | Low | 標準ユーティリティのみ使用 |
| correctionStatusBadge が長い場合 | Low | Low | truncate クラスの追加を検討 |

## 11. 結論

- **最大の問題**: CardHeader が `flex-row` 固定で、モバイル画面幅に対応していない
- **推奨修正順序**: CardHeader レスポンシブ化 → タブ幅最適化 → テスト
- **他 Issue への影響**: なし（CSS のみの変更で、ロジックに影響しない）
- **判定**: **GO** ✅ — CSS のみの修正で、ロジック変更なし。リスクが低い。
