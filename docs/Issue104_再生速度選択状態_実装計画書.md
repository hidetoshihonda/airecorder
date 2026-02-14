# Issue #104: 再生速度の選択状態が視覚的に分かりづらい — 実装計画書

> 作成日: 2025-07-17  
> 対象 Issue: #104  
> 前提: [Issue104_再生速度選択状態_分析レビュー.md](Issue104_再生速度選択状態_分析レビュー.md)  
> 判定: **GO** ✅  
> 工数: XS（40分）

---

## 1. 修正概要

### 問題

再生速度ボタンが未定義のCSS変数（`--color-primary`, `--color-muted`, `--color-accent`）に依存するTailwindクラスを使用しており、選択/非選択状態が視覚的に区別できない。

### 解決策

プロジェクトの既存UIコンポーネント（button.tsx, tabs.tsx）と同じ明示的Tailwindカラークラスに置き換える。

---

## 2. 変更ファイル一覧

| # | ファイル | 変更種類 | 変更行 | 内容 |
|---|---------|---------|--------|------|
| 1 | `web/src/app/recording/page.tsx` | 修正 | L735 | ラベルのテキストカラー修正 |
| 2 | `web/src/app/recording/page.tsx` | 修正 | L745 | 選択ボタンのスタイル修正 |
| 3 | `web/src/app/recording/page.tsx` | 修正 | L746 | 非選択ボタンのスタイル修正 |

**新規ファイル**: なし  
**削除ファイル**: なし

---

## 3. 具体的な修正内容

### 修正 1: ラベルの `text-muted-foreground` を `text-gray-500` に変更

**ファイル**: `web/src/app/recording/page.tsx` L735

```tsx
// Before
<span className="text-xs text-muted-foreground mr-1">

// After
<span className="text-xs text-gray-500 mr-1">
```

**根拠**: `card.tsx` の `CardDescription` が `text-gray-500` を使用しており、同じセマンティック（補足テキスト）。

### 修正 2: 選択ボタンのスタイル修正

**ファイル**: `web/src/app/recording/page.tsx` L745

```tsx
// Before
? "bg-primary text-primary-foreground"

// After
? "bg-gray-900 text-white shadow-sm font-medium"
```

**根拠**:
- `bg-gray-900 text-white`: `button.tsx` の `default` variant と同一
- `shadow-sm`: `tabs.tsx` の `TabsTrigger[data-[state=active]]` と同一パターン
- `font-medium`: 選択状態をフォントウェイトでも強調

### 修正 3: 非選択ボタンのスタイル修正

**ファイル**: `web/src/app/recording/page.tsx` L746

```tsx
// Before
: "bg-muted text-muted-foreground hover:bg-accent"

// After
: "bg-gray-100 text-gray-600 hover:bg-gray-200"
```

**根拠**:
- `bg-gray-100`: `tabs.tsx` の `TabsList` と同一
- `text-gray-600`: `button.tsx` の `secondary` variant (`text-gray-900`) より薄く、選択状態との差を確保
- `hover:bg-gray-200`: `button.tsx` の `secondary` variant の hover と同一

---

## 4. ビフォー/アフター比較

### Before（現状: CSS変数未定義）

```
┌─────────────────────────────────────────────────┐
│ 再生速度  [0.5x] [0.75x] [1x] [1.25x] [1.5x] [2x] │
│           ←── 全ボタンほぼ同じ見た目（透明/初期値）──→    │
└─────────────────────────────────────────────────┘
```

### After（修正後: 明示的カラー）

```
┌───────────────────────────────────────────────────────┐
│ 再生速度  [0.5x] [0.75x] [■1x■] [1.25x] [1.5x] [2x]  │
│           gray-100        gray-900       gray-100       │
│           (薄灰色)       (濃紺+白文字)    (薄灰色)        │
└───────────────────────────────────────────────────────┘
```

---

## 5. 実装手順

### Step 1: ブランチ作成

```bash
git checkout -b fix/issue-104-playback-speed-visual
```

### Step 2: コード修正（3箇所）

`web/src/app/recording/page.tsx` の以下3箇所を修正:

1. **L735**: `text-muted-foreground` → `text-gray-500`
2. **L745**: `"bg-primary text-primary-foreground"` → `"bg-gray-900 text-white shadow-sm font-medium"`
3. **L746**: `"bg-muted text-muted-foreground hover:bg-accent"` → `"bg-gray-100 text-gray-600 hover:bg-gray-200"`

### Step 3: ビルド確認

```bash
cd web && npm run build
```

### Step 4: 目視テスト

1. `npm run dev` でローカルサーバー起動
2. 録音詳細ページで再生速度ボタンの表示を確認
3. 各速度ボタンをクリックして選択状態の切り替えを確認
4. ホバー効果を確認

### Step 5: PR作成

```bash
git add web/src/app/recording/page.tsx
git commit -m "fix: improve playback speed button visual distinction (#104)"
git push origin fix/issue-104-playback-speed-visual
gh pr create --title "fix: improve playback speed button visual distinction (#104)" --body "..." --base main
```

---

## 6. テストチェックリスト

| # | テスト内容 | 期待結果 | 確認 |
|---|-----------|---------|------|
| 1 | 初期表示（1x選択） | 「1x」が濃色、他が薄灰色 | ☐ |
| 2 | 0.5x クリック | 「0.5x」が濃色に変化、「1x」が薄灰色に変化 | ☐ |
| 3 | 2.0x クリック | 「2.0x」のみ濃色 | ☐ |
| 4 | ホバー効果 | 非選択ボタンが `bg-gray-200` に変化 | ☐ |
| 5 | 速度変更→再生 | 選択した速度で再生される | ☐ |
| 6 | 再生中に速度変更 | リアルタイムで速度変化 | ☐ |
| 7 | 「再生速度」ラベル | gray-500 で表示される | ☐ |
| 8 | ダウンロードボタンとの共存 | レイアウト崩れなし | ☐ |

---

## 7. リスクと対策

| リスク | 対策 |
|--------|------|
| デザイン不整合 | Button/Tabs と同一カラーパレット使用で統一感を確保 |
| 機能退行 | CSSクラスのみの変更、ロジック未変更 |

---

## 8. 引き継ぎ情報

### EngineerDeploy への引き継ぎ

- 修正対象: **1ファイル、3行** のみ
- テスト: 目視テスト（自動テスト不要）
- デプロイ: 通常フロー（PR → CI/CD → マージ）

```
@EngineerDeploy Issue #104 を実装してデプロイして
```
