# Issue #8 多言語対応（i18n）— 深掘り分析レビュー

**Issue**: [#8](https://github.com/hidetoshihonda/airecorder/issues/8)
**作成日**: 2026-02-08
**ステータス**: 分析完了
**ブランチ**: `feature/i18n-support`

---

## 1. エグゼクティブサマリー

- **問題の本質**: 全UIが日本語ハードコードされており、英語・スペイン語ユーザーが利用不可能
- **影響範囲**: 全ページ・全コンポーネント（12+ ファイル、~190 個の翻訳対象文字列）
- **修正の緊急度**: P1（機能的にはブロッカーではないが、ユーザーベース拡大の前提条件）

### 🔴 最大の技術的課題

本プロジェクトは `output: "export"`（静的サイト）を使用しており、`next-intl` の **middleware によるロケールルーティングが使えない**。Issue が指定する `next-intl` は利用可能だが、セットアップ方法が通常と大幅に異なる。

---

## 2. アーキテクチャ概観

### 2.1 現在のルーティング構造

```
web/src/app/
├── layout.tsx          ← html lang="ja" ハードコード
├── page.tsx            ← メイン録音ページ（971行、~51個の翻訳文字列）
├── history/page.tsx    ← 録音履歴（355行、~20個）
├── settings/page.tsx   ← 設定（~25個）
├── recording/page.tsx  ← 録音詳細（544行、~32個）
├── privacy/page.tsx    ← プライバシー（法的文書 ~30個）
└── terms/page.tsx      ← 利用規約（法的文書 ~40個）
```

### 2.2 コンポーネント依存関係

```
layout.tsx
├── Header.tsx          ← ナビゲーション（7個の翻訳文字列）
├── Footer.tsx          ← フッター（3個）
├── Providers.tsx       ← AuthProvider, ThemeProvider
│   └── AuthContext.tsx ← UserSettings（locale フィールドなし）
└── [各ページ]
    ├── page.tsx        ← TranscriptView, useSpeechRecognition 等
    │   └── TranscriptView.tsx ← 1個
    ├── history/page.tsx
    ├── settings/page.tsx
    └── recording/page.tsx
```

### 2.3 技術的制約

| 制約 | 影響 |
|------|------|
| `output: "export"` | middleware 不可、サーバーサイドロケール検出不可 |
| Azure SWA | `staticwebapp.config.json` でルーティング制御 |
| 全ページ `"use client"` | サーバーコンポーネントの i18n パターンが不要 |
| `useTranslation.ts` が既存 | Azure Translator API 用フック。i18n 用とは別名が必要 |

---

## 3. 重大な設計判断 🔴

### DECISION-1: `next-intl` のセットアップ方式

**問題**: `output: "export"` + `next-intl` の組み合わせには3つの選択肢がある

#### Option A: `[locale]` ルートセグメント方式（next-intl 推奨）

```
web/src/app/
└── [locale]/
    ├── layout.tsx
    ├── page.tsx
    ├── history/page.tsx
    └── ...
```

- ✅ `next-intl` の公式推奨パターン
- ✅ SEO 対応（`/ja/`, `/en/`, `/es/` のURL）
- ✅ `generateStaticParams` で全ロケール分を静的生成
- ❌ **全ページのディレクトリ構造を変更する必要あり**
- ❌ `staticwebapp.config.json` のルーティング設定変更が必要
- ❌ 既存のブックマーク・リンクが壊れる
- ⚠️ `output: "export"` では `localePrefix: "always"` が必須

#### Option B: non-routing 方式（ルート構造変更なし）

```
web/src/app/
├── layout.tsx            ← NextIntlClientProvider で locale を注入
├── page.tsx              ← useTranslations('HomePage') で翻訳
└── ...（構造変更なし）
```

- ✅ **ルート構造変更不要**（最小の破壊的変更）
- ✅ Azure SWA 設定変更不要
- ✅ 既存 URL 互換
- ✅ `next-intl` の `useTranslations` が使える
- ❌ URL にロケールが含まれない（SEO 弱い）
- ❌ ブラウザの戻る/進むでロケールが保持されない
- ⚠️ `i18n/request.ts` で静的ロケール or cookie/localStorage から取得

#### Option C: 自前の軽量 i18n（next-intl 不使用）

- ✅ 依存なし、フルコントロール
- ✅ `output: "export"` の制約を完全に回避
- ❌ ICU メッセージ構文、pluralization、日付フォーマット等の再実装が必要
- ❌ Issue が `next-intl` を指定している

### 📌 推奨: Option B（non-routing 方式）

**理由**:
1. `output: "export"` との互換性が最も高い
2. ルート構造の大変更によるリグレッションリスクを回避
3. 全ページが `"use client"` であり、`NextIntlClientProvider` + `useTranslations` で十分
4. ユーザーの `localStorage` でロケール永続化し、ページリロードなしで切り替え可能
5. SEO は本アプリの要件としては低優先度（認証必須のツールアプリ）

---

## 4. 設計上の課題 🟡

### DESIGN-1: `useTranslation` フック名の衝突（Medium）

**場所**: `web/src/hooks/useTranslation.ts`

**問題**: 既存の `useTranslation` は Azure Translator API を呼ぶフック。`next-intl` は `useTranslations` を提供するため名前衝突はないが、開発者の混乱を招く可能性がある。

**対策**: 既存フックは `useTranslation`（単数形）、next-intl は `useTranslations`（複数形）で区別可能。ドキュメントに明記する。

### DESIGN-2: `UserSettings` にロケールフィールドがない（Medium）

**場所**: `web/src/types/index.ts` — `UserSettings` インターフェース

**問題**: 現在の `UserSettings` には UI 言語を保存するフィールドがない。

**修正**: `uiLanguage: "ja" | "en" | "es"` を追加する。

### DESIGN-3: 法的文書ページの翻訳戦略（Low）

**場所**: `web/src/app/privacy/page.tsx`, `web/src/app/terms/page.tsx`

**問題**: プライバシーポリシーと利用規約は全文日本語（~70 文字列）。法的文書の翻訳は専門的で、機械翻訳では法的効力が不確実。

**対策**: Phase 1 では日本語のみ維持し、ヘッダー/フッター等のナビゲーション部分のみ翻訳。Phase 2 で正式翻訳を検討。

### DESIGN-4: `alert()` / `confirm()` / `prompt()` の使用（Medium）

**場所**: page.tsx (~5箇所), history/page.tsx (~3箇所), recording/page.tsx (~3箇所)

**問題**: ブラウザネイティブダイアログは翻訳対象文字列を引数に取る。`next-intl` の `useTranslations` で翻訳可能だが、ネイティブダイアログ自体のボタンテキスト（「OK」「キャンセル」）はブラウザ言語に依存する。

**対策**: `useTranslations` でメッセージ文字列を翻訳して渡す。将来的にカスタムダイアログコンポーネントに置き換え。

### DESIGN-5: 日付ロケールのハードコード（Medium）

**場所**: `page.tsx`, `history/page.tsx`, `recording/page.tsx`

**問題**: `toLocaleDateString("ja-JP")` が3箇所でハードコードされている。

**修正**: `next-intl` の `useFormatter` で日付フォーマットするか、`toLocaleDateString(locale)` にロケール変数を渡す。

---

## 5. 依存関係マトリクス 📊

### 5.1 翻訳対象ファイル一覧

| ファイル | 翻訳文字列数 | 複雑度 | 優先度 |
|---------|------------|--------|--------|
| `app/page.tsx` | ~51 | High（長文・条件分岐多） | P0 |
| `app/recording/page.tsx` | ~32 | High | P0 |
| `app/history/page.tsx` | ~20 | Medium | P0 |
| `app/settings/page.tsx` | ~25 | Medium | P0 |
| `components/layout/Header.tsx` | ~7 | Low | P0 |
| `components/layout/Footer.tsx` | ~3 | Low | P0 |
| `app/layout.tsx` | ~7（metadata） | Medium | P1 |
| `components/TranscriptView.tsx` | ~1 | Low | P0 |
| `contexts/AuthContext.tsx` (AuthGate) | ~9 | Low | P0 |
| `hooks/useTranslation.ts` | ~3（エラーメッセージ） | Low | P2 |
| `app/privacy/page.tsx` | ~30+ | High（法的文書） | P2 |
| `app/terms/page.tsx` | ~40+ | High（法的文書） | P2 |

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `next-intl` | `output: "export"` | non-routing 方式で回避 | Option B 採用 |
| `NextIntlClientProvider` | `layout.tsx` | Provider 追加のみ | 既存 Providers に追加 |
| `UserSettings.uiLanguage` | `AuthContext` + `localStorage` | 型の破壊的変更 | デフォルト値 `"ja"` で後方互換 |
| `staticwebapp.config.json` | Azure SWA | 変更不要（Option B） | — |
| 翻訳 JSON ファイル | 全コンポーネント | 翻訳漏れ | TypeScript 型チェック |

### 5.3 他 Issue/機能との相互作用

- **Issue #6（議事録テンプレート）**: テンプレート名・説明文も翻訳対象になる。i18n 基盤を先に入れておくと #6 実装時に最初から翻訳対応できる。
- **PR #22 の全変更**: マージ済みで `main` に統合されているため衝突リスクなし。

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| `navigator.language` | 全モダンブラウザ対応 | なし |
| `localStorage` | 全モダンブラウザ対応 | プライベートブラウジングで制限あり（既存の挙動と同じ） |
| CSS `dir` 属性 | ja/en/es は全て LTR | なし（RTL 言語は対象外） |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 基盤構築 + 主要ページ翻訳（P0）— 約2時間

#### Step 1-1: `next-intl` インストール + 設定ファイル作成

```bash
npm install next-intl
```

**新規ファイル**:
- `web/src/i18n/request.ts` — ロケール設定
- `web/messages/ja.json` — 日本語メッセージ
- `web/messages/en.json` — 英語メッセージ
- `web/messages/es.json` — スペイン語メッセージ
- `web/next.config.ts` — `createNextIntlPlugin` 追加

#### Step 1-2: `UserSettings` にロケールフィールド追加

```typescript
export interface UserSettings {
  // ... existing fields
  uiLanguage: "ja" | "en" | "es";  // 追加
}
```

#### Step 1-3: `layout.tsx` に `NextIntlClientProvider` 追加

```tsx
import { NextIntlClientProvider } from 'next-intl';

// locale は localStorage / ブラウザ検出から取得
<NextIntlClientProvider locale={locale} messages={messages}>
  {children}
</NextIntlClientProvider>
```

#### Step 1-4: Header に言語切替 UI 追加

ドロップダウンメニューで `🇯🇵 日本語` / `🇺🇸 English` / `🇪🇸 Español` を選択可能に。

#### Step 1-5: 全主要ページの翻訳キー化

- `page.tsx` (~51 文字列)
- `history/page.tsx` (~20 文字列)
- `settings/page.tsx` (~25 文字列)
- `recording/page.tsx` (~32 文字列)
- `Header.tsx` (~7 文字列)
- `Footer.tsx` (~3 文字列)
- `TranscriptView.tsx` (~1 文字列)
- `AuthContext.tsx` AuthGate (~9 文字列)

### Phase 2: メタデータ + 法的文書（P1）— 約1時間

- `layout.tsx` の metadata を動的にする
- `privacy/page.tsx`, `terms/page.tsx` の翻訳（または英語版作成）

### Phase 3: エッジケース + 最終調整（P2）— 約30分

- `useTranslation.ts` のエラーメッセージ翻訳
- `toLocaleDateString` のロケール動的化
- `alert()` / `confirm()` のメッセージ翻訳

---

## 8. テスト戦略

### 状態遷移テスト（Unit）
| テスト | 確認事項 |
|--------|---------|
| ロケール切替 `ja → en → es` | 全文字列が正しく切り替わる |
| ロケール永続化 | `localStorage` に保存され、リロード後も維持 |
| ブラウザ言語自動検出 | 初回アクセスで `navigator.language` に基づくロケール |
| フォールバック | 未対応言語の場合 `en` にフォールバック |

### 手動テスト
| シナリオ | 確認事項 |
|---------|---------|
| 各言語で録音 → 保存 → 履歴 → 詳細 | 全画面遷移で翻訳が維持 |
| 設定変更 → リロード | 設定言語が保持される |
| 翻訳漏れチェック | 各言語で日本語文字列が残っていないか |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1-1 | next-intl インストール + 設定 | 15min | next.config.ts, i18n/ |
| 1-2 | 翻訳 JSON ファイル作成（3言語） | 30min | messages/ |
| 1-3 | UserSettings + layout.tsx + Provider | 15min | types, layout, Providers |
| 1-4 | Header 言語切替 UI | 15min | Header.tsx |
| 1-5 | 全主要ページの翻訳キー化 | 45min | page.tsx ×5, components ×3 |
| 1-6 | ビルド確認 + デプロイ | 15min | — |
| **合計** | | **~2.5h** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| `next-intl` + `output: "export"` の非互換 | Low | High | non-routing 方式で回避。事前検証済み |
| 翻訳漏れ | Medium | Medium | TypeScript 型チェック + 手動レビュー |
| 英語/スペイン語の翻訳品質 | Medium | Medium | ネイティブレビュー or AI 翻訳 + 人間チェック |
| `useTranslation` / `useTranslations` の混乱 | Low | Low | 命名規則をドキュメント化 |
| Bundle サイズ増加 | Low | Low | `next-intl` は ~15KB gzip、翻訳 JSON は分割ロード可能 |
| 法的文書の翻訳の法的妥当性 | Medium | High | Phase 1 では法的文書は翻訳しない |

---

## 11. 結論

- **最大の課題**: `output: "export"` と `next-intl` の組み合わせだが、**non-routing 方式**で解決可能
- **推奨する修正順序**: 基盤設定 → 翻訳 JSON 作成 → Provider 追加 → Header 言語切替 → 各ページ翻訳キー化
- **他 Issue への影響**: #6（テンプレート）の実装時に i18n 基盤が利用可能になるメリットあり
- **翻訳対象**: ~150 文字列（法的文書除く）、3言語 = ~450 翻訳エントリ

### 🟢 GO

- non-routing 方式により `output: "export"` との互換性を確保
- 全ページが `"use client"` のため `NextIntlClientProvider` + `useTranslations` で統一的に対応可能
- 既存の URL 構造・Azure SWA 設定を変更する必要がない
- 推定工数 ~2.5 時間で実装可能
