# Issue #88: マインドマップ自動生成 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 会議内容をテキスト形式（議事録・文字起こし）でしか確認できず、会話構造の全体像を直感的に把握する手段がない。競合5/10製品が搭載する機能。
- **影響範囲**: 全ユーザーへの付加価値提供。議事録タブが既にある録音に対して追加タブを表示。
- **修正の緊急度**: **P3 — Enhancement** — 競合キャッチアップのPhase 2対象。新機能追加であり既存機能への影響なし。

---

## 2. アーキテクチャ概観

### 2.1 現在のタブ構造

```
recording/page.tsx
├── Tabs (grid-cols-4)
│   ├── TabsTrigger "transcript"  — 文字起こし
│   ├── TabsTrigger "translation" — 翻訳
│   ├── TabsTrigger "summary"     — 議事録
│   └── TabsTrigger "askAi"       — Ask AI
└── 追加予定:
    └── TabsTrigger "mindmap"     — マインドマップ ★NEW
```

### 2.2 提案アーキテクチャ

```
[フロントエンド]
recording/page.tsx
├── "mindmap" TabsContent
│   └── <MindMapPanel />  ← 新コンポーネント
│       ├── 生成ボタン → API呼び出し
│       ├── markmap-lib: Markdown → MindMap Tree 変換
│       ├── markmap-view: SVG レンダリング
│       └── エクスポートボタン（SVG/PNG）

[バックエンド]
api/src/functions/mindmap.ts  ← 新規
├── POST /api/mindmap/generate
│   ├── transcript を受け取る
│   ├── Azure OpenAI で Markmap形式 Markdown を生成
│   └── Markmap Markdown テキストを返す
└── 結果はフロントで recording.mindmapMarkdown に保存（updateRecording 経由）

[データモデル]
Recording {
  ...existing fields,
  mindmapMarkdown?: string;  // Markmap形式 Markdown キャッシュ ★NEW
}
```

### 2.3 データフロー

```
[生成フロー]
ユーザー → 「生成」ボタン
  → transcript テキスト取得（getTranscriptWithSpeakerLabels）
  → POST /api/mindmap/generate { transcript, language }
  → Azure OpenAI: Markmap Markdown 生成
  → レスポンス: { markdown: "# 会議名\n## 議題1\n### ..." }
  → recordingsApi.updateRecording(id, { mindmapMarkdown })  ← キャッシュ保存
  → markmap-lib: Transformer.transform(markdown) → MindMap Root
  → markmap-view: Markmap.create(svgEl, options, root)
  → SVG レンダリング完了

[キャッシュ読み込みフロー]
ページロード → recording.mindmapMarkdown が存在
  → markmap-lib でパース → markmap-view でレンダリング
  → API呼び出し不要（即時表示）
```

---

## 3. 重大バグ分析 🔴

該当なし。Issue #88 は新機能追加。

---

## 4. 設計上の問題 🟡

### DESIGN-1: タブ数の増加（4→5）

**場所**: `recording/page.tsx` L886  
**コード**: `<TabsList className="grid w-full grid-cols-4">`  
**問題**: 現在4カラムのグリッドレイアウト。5タブ目を追加すると `grid-cols-5` に変更が必要。モバイルでは5タブは窮屈になる可能性あり。  
**修正方針**: `grid-cols-5` に変更 + タブテキストを短縮 or アイコンのみ表示（モバイル時）。または `overflow-x-auto` でスクロール可能に。

### DESIGN-2: markmap ライブラリの SSR 互換性

**問題**: `markmap-view` は DOM 操作（SVG）を直接行うため、Next.js の SSR/SSG と非互換。  
**修正方針**: `dynamic(() => import(...), { ssr: false })` で動的インポートするか、`useEffect` 内でのみ markmap を初期化する。

### DESIGN-3: マインドマップデータのキャッシュ戦略

**問題**: 生成結果をどこに保存するか。  
**選択肢**:
- A) `Recording.mindmapMarkdown` フィールド追加（CosmosDB）← **推奨**
- B) フロントのみ（localStorage） — 複数デバイスで不可
- C) 別ドキュメント — 過剰設計

**修正方針**: 議事録（`summary`）と同様に `Recording` ドキュメントに `mindmapMarkdown?: string` を追加。既存の `updateRecording` API で保存可能。

### ✅ Good: 既存のインフラで実現可能

- Azure OpenAI クライアント — `summary.ts` と同じ構成で再利用可能
- `updateRecording` API — 追加フィールドの保存に対応済み
- `getTranscriptWithSpeakerLabels()` — 議事録と同じ入力データを使用可能
- タブ UI コンポーネント — Radix UI Tabs で簡単に追加可能

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #88 ──→ Issue #85  [関連: Ask AI と同様の transcript 活用パターン]
Issue #88 ──→ Issue #120 [関連: getTranscriptWithSpeakerLabels 共有]
Issue #88 ──→ Issue #87  [関連: エクスポート機能の拡張]
```

ブロッカーなし。全て独立して実装可能。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| markmap-lib | npm パッケージ | Low | well-maintained (GitHub 7k+ stars) |
| markmap-view | npm パッケージ + D3.js | Medium | SSR非互換 → dynamic import |
| マインドマップ生成API | Azure OpenAI | Low | summary.ts と同パターン |
| データ保存 | updateRecording API | Low | フィールド追加のみ |

### 5.3 新規 npm 依存関係

| パッケージ | 用途 | サイズ | 備考 |
|-----------|------|--------|------|
| `markmap-lib` | Markdown → MindMap Tree 変換 | ~50KB | 必須 |
| `markmap-view` | SVG レンダリング | ~30KB | 必須（D3.js 含む） |
| `markmap-common` | 共有型定義 | ~10KB | markmap-lib の依存 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome / Edge | ✅ SVG 完全対応 | なし |
| Safari / iOS | ⚠️ SVG touch操作 | Medium — ピンチズームの挙動確認必要 |
| Firefox | ✅ SVG 対応 | なし |
| SSR (Next.js) | ❌ markmap-view は CSR のみ | High — dynamic import 必須 |

---

## 7. 修正提案（優先順位付き）

### Phase 1: コア実装（P0）

#### 新規ファイル

| # | ファイル | 概要 |
|---|---------|------|
| 1 | `api/src/functions/mindmap.ts` | マインドマップ生成 API エンドポイント |
| 2 | `web/src/services/mindmapApi.ts` | フロントエンド API クライアント |
| 3 | `web/src/components/MindMapPanel.tsx` | マインドマップ表示コンポーネント |

#### 修正ファイル

| # | ファイル | 変更内容 |
|---|---------|---------|
| 4 | `api/src/index.ts` | `import "./functions/mindmap"` 追加 |
| 5 | `api/src/models/Recording.ts` | `mindmapMarkdown?: string` フィールド追加 |
| 6 | `web/src/types/index.ts` | `mindmapMarkdown?: string` フィールド追加 |
| 7 | `web/src/app/recording/page.tsx` | マインドマップタブ追加 |
| 8 | `web/src/services/index.ts` | mindmapApi エクスポート追加 |
| 9 | `web/messages/ja.json` | i18n キー追加 |
| 10 | `web/messages/en.json` | i18n キー追加 |
| 11 | `web/messages/es.json` | i18n キー追加 |
| 12 | `web/package.json` | markmap 依存追加 |

#### 1. API: `api/src/functions/mindmap.ts`

GPT に Markmap 形式の Markdown を生成させる。議事録生成（`summary.ts`）と同じパターン。

```typescript
// システムプロンプト（Markmap 形式 Markdown 生成）
const MINDMAP_SYSTEM_PROMPT = `あなたは会議内容を構造化するエキスパートです。
与えられた文字起こしから、マインドマップ用の Markdown を生成してください。

【出力形式】
- Markdown の見出し構造（#, ##, ###, ####）を使用
- ルートノード（#）は会議名またはテーマ
- 第2レベル（##）は主要な議題・トピック
- 第3レベル（###）はサブトピック・詳細
- 第4レベル（####）は具体的な決定事項・アクションアイテム
- 各ノードは簡潔に（1-2文以内）
- 箇条書き（-）でノードの補足情報を追加可能
- 全ての重要な議題を漏れなく含める
- 決定事項とアクションアイテムは明確にマーク

【出力例】
# プロジェクト進捗会議
## 開発進捗
### フロントエンド
- React 移行 80% 完了
#### 決定: 来週中にβ版リリース
### バックエンド
- API v2 設計完了
#### TODO: 負荷テスト実施（田中）
## 課題・リスク
### パフォーマンス問題
- ページ読み込み3秒超過
#### 対策: CDN 導入検討
## 次回アクション
### 来週火曜 14:00 再MTG`;
```

**エンドポイント**: `POST /api/mindmap/generate`
**入力**: `{ transcript: string, language?: string }`
**出力**: `{ success: true, data: { markdown: string } }`

#### 2. フロントエンド: `MindMapPanel.tsx`

```tsx
// 主要な構成:
// - 生成ボタン（未生成時）
// - markmap SVG 表示（生成済み時）
// - 再生成ボタン
// - エクスポートボタン（SVG/PNG）
// - markmap-lib + markmap-view を dynamic import
```

#### 3. `recording/page.tsx` の変更

- `grid-cols-4` → `grid-cols-5` に変更
- `TabsTrigger value="mindmap"` 追加
- `TabsContent value="mindmap"` に `<MindMapPanel />` 配置

### Phase 2: UX改善（P1）

- ズーム・パン操作のタッチ対応
- ノードの展開/折りたたみ
- カラーテーマ設定
- マインドマップの編集機能（ノード追加/削除）

### Phase 3: 堅牢性強化（P2）

- 長い会議での分割生成（トークン制限対応）
- オフラインキャッシュ
- 共有URL生成

---

## 8. テスト戦略

### 状態遷移テスト（Unit）
- transcript なし → 生成ボタン無効
- transcript あり + mindmapMarkdown なし → 生成ボタン有効
- 生成中 → ローディング表示
- 生成完了 → SVG レンダリング + キャッシュ保存
- 生成エラー → エラーメッセージ表示
- キャッシュあり → 即時レンダリング（API 不要）
- 再生成 → 新しいマインドマップに置換

### 手動テスト
- 話者分離ありの録音 → マインドマップ生成 → 話者情報反映
- 短い録音（1分） → シンプルなマインドマップ
- 長い録音（60分+） → 複雑なマインドマップ（ズーム必要）
- モバイル → タッチ操作（ピンチズーム、ドラッグ）
- SVG エクスポート → ファイルダウンロード
- ページリロード → キャッシュからの再表示

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | npm install markmap-lib markmap-view | 5分 | web/package.json |
| 2 | Recording 型に mindmapMarkdown 追加 | 5分 | types, models |
| 3 | api/src/functions/mindmap.ts 作成 | 30分 | API 新規 |
| 4 | api/src/index.ts に import 追加 | 1分 | API エントリ |
| 5 | web/src/services/mindmapApi.ts 作成 | 15分 | フロントAPI |
| 6 | web/src/components/MindMapPanel.tsx 作成 | 60分 | フロントUI |
| 7 | recording/page.tsx にタブ追加 | 15分 | 録音詳細画面 |
| 8 | i18n メッセージ追加 (3ファイル) | 10分 | メッセージ |
| 9 | ビルド・ESLint 確認 | 10分 | - |
| 10 | 動作確認・デバッグ | 30分 | - |
| **合計** | | **約3時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| markmap SSR エラー | 高 | 高 | dynamic import + ssr: false |
| GPT出力が不正な Markdown | 中 | 中 | フォールバック表示（rawテキスト） |
| 長い会議でトークン制限超過 | 中 | 中 | transcript 切り詰め（askAi.ts と同パターン） |
| markmap バンドルサイズ増大 | 低 | 中 | dynamic import でコード分割 |
| モバイルでの SVG 操作性 | 中 | 低 | CSS touch-action 設定 |
| D3.js と既存ライブラリの競合 | 低 | 高 | markmap-view が D3 を内包 |

---

## 11. 結論

- **最大のポイント**: `markmap-lib` + `markmap-view` の採用により、GPT で Markmap 形式 Markdown を生成するだけで、高品質なインタラクティブマインドマップをレンダリングできる。
- **推奨する修正順序**: API エンドポイント → フロントコンポーネント → タブ統合 → i18n → テスト
- **他 Issue への影響**: なし。完全に独立した新機能。
- **注意点**: markmap の SSR 非互換性は dynamic import で解決必須。議事録生成（summary.ts）と同じパターンで API 実装可能。
- **判定**: **GO** ✅ — 工数 M（3-5日）の見積りは妥当。既存インフラの再利用で効率的に実装可能。
