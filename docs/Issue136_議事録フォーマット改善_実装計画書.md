# Issue #136: 議事録フォーマット改善 — 実装計画書

> この計画書は [Issue136_議事録フォーマット改善_分析レビュー.md](./Issue136_議事録フォーマット改善_分析レビュー.md) の分析結果に基づく。

---

## 概要

Issue #136 は「デフォルトの議事録生成プロンプトをより詳細なビジネス向けフォーマットに変更する」要望。  
分析の結果、**API側の `general` テンプレートは既に高品質であり、追加で必要な変更は限定的**。  
主な作業は以下の4点:

1. デフォルトテンプレートIDの統一（`"summary"` → `"general"`）
2. `general` プロンプトへの強化指示追加（要確認表現、太字、Q&A抽出、次回の進め方）
3. `SummaryResponse` / `Summary` 型への `nextSteps` フィールド追加
4. フロントエンドのテンプレートID不整合解消

---

## Step 1: デフォルトテンプレートIDの統一

### 変更ファイル

| ファイル | 行 | 変更内容 |
|---------|-----|---------|
| `web/src/app/recording/page.tsx` | L128 | `useState<TemplateId>("summary")` → `useState<TemplateId>("general")` |
| `web/src/app/page.tsx` | L91 | `useState<TemplateId>("summary")` → `useState<TemplateId>("general")` |

### 理由
- 現在、詳細ページと再生成ダイアログのデフォルトが `"summary"`（簡潔要約）になっている
- せっかく実装済みの詳細議事録テンプレート（`general`）がデフォルトで使われていない
- メインページ初回生成（L81）は既に `"general"` なので、それに合わせて統一

---

## Step 2: `general` プロンプトの強化

### 変更ファイル

| ファイル | 箇所 | 変更内容 |
|---------|------|---------|
| `api/src/functions/summary.ts` | L164-179 `TEMPLATE_PROMPTS["general"]` | プロンプト強化 |
| `api/src/functions/summary.ts` | L78-141 `JSON_FORMAT` | `nextSteps` フィールド追加 |

### `general` プロンプトへの追加指示

現在の `general` テンプレートに以下の指示を追加:

```
追加ルール:
- 金額、日付、数値、パーセンテージなどの重要な数値は **太字** で記載すること
- 発言内容が曖昧な場合や、文字起こしの精度に不安がある箇所は「（要確認）」と明記すること
- 根拠のない推測や解釈は行わず、文字起こしに含まれる情報のみを記載すること
- 質疑応答がある場合は、topics内の discussion で Q: / A: 形式で記載すること
- 参加者の役割が推測できる場合は meetingInfo.participants に役割を付記すること（例: "田中（PM）"）
```

### `JSON_FORMAT` への `nextSteps` 追加

現在の JSON_FORMAT の `importantNotes` の後に追加:

```json
"nextSteps": [
  "次回の予定やアジェンダ案",
  "確認事項や宿題の期限",
  "フォローアップ事項"
]
```

---

## Step 3: 型定義の更新

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `api/src/functions/summary.ts` | `SummaryResponse` に `nextSteps?: string[]` 追加 |
| `web/src/types/index.ts` | `Summary` に `nextSteps?: string[]` 追加 |
| `api/src/models/recording.ts` | `Summary` に `nextSteps?: string[]` 追加 |

### 注意
- 全て **optional** フィールドとして追加（既存データとの後方互換性を保つ）
- API側のレスポンスパース部分（summary.ts L332付近）に `nextSteps` の取り出しを追加

---

## Step 4: フロントエンド表示の更新

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/src/app/page.tsx` | Summary表示部分に `nextSteps` セクションを追加 |
| `web/src/app/recording/page.tsx` | Summary表示部分に `nextSteps` セクションを追加 |

### 表示仕様
- `summary.nextSteps` が存在し、配列が空でない場合のみ表示
- 「📋 次回に向けて」のようなヘッダーで箇条書き表示
- 既存の `importantNotes` セクションの後に配置

---

## Step 5: テンプレートID整合

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/src/lib/meetingTemplates.ts` | `PRESET_TEMPLATES` の `id: "meeting"` → `id: "general"` に変更 |

### 注意
- フロントエンドの「一般的な会議」テンプレートが `id: "meeting"` だが、API側に対応するキーがない
- `"general"` に変更することで、API側の `TEMPLATE_PROMPTS["general"]` と直接一致
- テンプレート名（`name` プロパティ）や説明文は変更不要

---

## Step 6: フロントエンド JSON_FORMAT 更新（任意・P2）

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/src/lib/meetingTemplates.ts` L4-41 | 旧形式 JSON_FORMAT → API側の新形式に更新 |

### 理由
- カスタムテンプレート作成時に `JSON_FORMAT` がベースとして使用される
- 現在は旧形式（overview, keyPoints, actionItems）だが、APIの新形式（meetingInfo, agenda, topics...）に合わせるべき
- ただし、カスタムテンプレートのプロンプトに JSON_FORMAT が含まれていても、実際の出力はAPI側のパースに依存するため、影響は限定的

---

## 実装順序

```
Step 1: デフォルトテンプレートID統一 (5分)
  ↓
Step 2: general プロンプト強化 + JSON_FORMAT に nextSteps 追加 (15分)
  ↓
Step 3: 型定義更新（API + Web） (10分)
  ↓
Step 4: フロントエンド nextSteps 表示 (10分)
  ↓
Step 5: テンプレートID整合 (10分)
  ↓
Step 6: (任意) フロントエンド JSON_FORMAT 更新 (10分)
  ↓
ビルド確認・テスト (10分)
```

**合計見積: 約60-70分**

---

## テスト確認項目

| # | テストケース | 期待結果 |
|---|---|---|
| 1 | 詳細ページで「AIで生成」→ デフォルト | `general` テンプレートで詳細議事録が生成 |
| 2 | 再生成ダイアログのデフォルト | `general` が初期選択 |
| 3 | `summary` テンプレートを選択して生成 | 従来通り簡潔要約が生成 |
| 4 | カスタムテンプレートで生成 | カスタムプロンプトがそのまま使用 |
| 5 | 既存保存済み議事録を表示 | nextSteps がなくてもエラーなく表示 |
| 6 | 新規生成した議事録に nextSteps あり | 「次回に向けて」セクション表示 |
| 7 | 曖昧な発言を含む文字起こしで生成 | 「（要確認）」が適切に付与 |
| 8 | 数値を含む文字起こしで生成 | 太字で表示 |

---

## 判定: ✅ GO

変更範囲が限定的（プロンプト微調整 + デフォルト変更 + optional フィールド追加）で、後方互換性も完全に保たれる。
