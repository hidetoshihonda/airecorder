# Issue #136: 議事録フォーマットを詳細ビジネス向けテンプレートに変更 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: Issue #136 は「デフォルトの議事録生成プロンプトをより詳細なビジネス向けフォーマットに変更する」要望だが、**実は現在のAPI側 `general` テンプレートは既にかなり詳細なビジネス向けフォーマット（Issue #42 v2 で改善済み）** であり、要望されている8セクション構成の大部分が既に実装されている。真の問題は **フロントエンドとAPIのテンプレート不整合** と **デフォルトテンプレート選択の問題** にある。
- **影響範囲**: 全ユーザーの議事録生成に影響（デフォルトプロンプト変更）。既存カスタムテンプレートユーザーには影響なし。
- **緊急度**: 🟡 Medium — 機能改善。既存機能は動作しており致命的問題はない。

---

## 2. アーキテクチャ概観

### 2.1 議事録生成フロー

```
[ユーザー操作]
  ├── メインページ: "AIで議事録生成" ボタン → デフォルト templateId="general"
  ├── 詳細ページ: "AIで生成" ボタン → デフォルト templateId="summary"  ← ⚠️ 軽量テンプレート
  └── 再生成ダイアログ: テンプレート選択グリッド → 選択した templateId
         ▼
[summaryApi.generateSummary()]
  POST /api/summary/generate
  { transcript, language, templateId, customPrompt? }
         ▼
[API: summary.ts]
  resolveSystemPrompt(templateId, customPrompt)
  ├── customPrompt あり → customPrompt を使用
  ├── templateId がプリセットに存在 → TEMPLATE_PROMPTS[templateId]
  └── それ以外 → TEMPLATE_PROMPTS["general"] (デフォルト)
         ▼
[Azure OpenAI] gpt-5-mini, temperature=0.3, max_tokens=4000
  response_format: { type: "json_object" }
         ▼
[レスポンス解析]
  JSON → SummaryResponse (caution, meetingInfo, agenda, topics, decisions, actionItems, importantNotes)
         ▼
[フロントエンド表示]
  構造化された6セクション表示（caution, 会議情報, アジェンダ, 議題詳細, 決定事項, ToDo, 重要メモ）
```

### 2.2 テンプレート管理の二重構造

```
[API側 (summary.ts)]                    [フロントエンド側 (meetingTemplates.ts)]
TEMPLATE_PROMPTS = {                     PRESET_TEMPLATES = [
  "summary"    → 簡潔要約(旧形式)         { id: "summary",    ... },
  "general"    → 詳細議事録(v2)            { id: "meeting",    ... },  ← ⚠️ API側に "meeting" なし
  "regular"    → 定例会議(v2)              { id: "one-on-one", ... },
  "one-on-one" → 1on1(v2)                 { id: "sales",      ... },
  "sales"      → 商談(v2)                 { id: "dev-sprint", ... },
  "dev-sprint" → 開発(v2)                 { id: "brainstorm", ... },
  "brainstorm" → ブレスト(v2)            ]
}
```

---

## 3. 設計上の問題 🟡

### ISSUE-1: フロントエンドのデフォルトテンプレートが「summary（簡潔要約）」

**場所**: 
- [web/src/app/recording/page.tsx](../web/src/app/recording/page.tsx) L128: `useState<TemplateId>("summary")`
- [web/src/app/page.tsx](../web/src/app/page.tsx) L91: `useState<TemplateId>("summary")` (再生成ダイアログ)

**問題**: 詳細ページの初回生成デフォルトが `"summary"`（簡潔要約）になっている。ユーザーが「AIで生成」を押すと、概要+キーポイントだけの簡素な出力になり、Issue #136 で求められている詳細な議事録にならない。

**影響**: ユーザーの多くが詳細議事録ではなく簡潔要約を見てしまい、「精度が低い」「情報が少ない」という印象を持つ可能性。

**重要度**: 🟠 High

---

### ISSUE-2: テンプレートID不整合（frontend "meeting" ↔ API "general"）

**場所**: 
- [web/src/lib/meetingTemplates.ts](../web/src/lib/meetingTemplates.ts) L87: `id: "meeting"` 
- [api/src/functions/summary.ts](../api/src/functions/summary.ts) L166: `general:` プリセット

**問題**: フロントエンドのプリセットに `id: "meeting"` があるが、API側に `"meeting"` キーは存在しない。APIの `resolveSystemPrompt` で `"meeting"` は見つからず、**`"general"` にフォールバック**する。結果的に動作するが、意図的でない。

**影響**: 動作上の問題は小さい（general にフォールバックするため）が、コードの意図が不明瞭。

**重要度**: 🟡 Medium

---

### ISSUE-3: フロントエンドとAPIのJSON_FORMATが乖離

**場所**: 
- [web/src/lib/meetingTemplates.ts](../web/src/lib/meetingTemplates.ts) L4-41: 旧形式 JSON_FORMAT (`overview`, `keyPoints`, `actionItems`)
- [api/src/functions/summary.ts](../api/src/functions/summary.ts) L78-141: 新形式 JSON_FORMAT (`meetingInfo`, `agenda`, `topics`, `decisions`, `actionItems`, `importantNotes`)

**問題**: フロントエンドのプリセットテンプレートの `systemPrompt` には **旧形式** の JSON_FORMAT が埋め込まれているが、プリセット使用時はAPI側のプロンプトが優先されるため実害はない。ただし、カスタムテンプレート作成時にフロントエンド側の旧形式をベースにすると、新しいUI表示（6セクション）と不整合が起きる。

**重要度**: 🟡 Medium

---

### ISSUE-4: ✅ Good — API側の `general` テンプレートは既に高品質

[api/src/functions/summary.ts](../api/src/functions/summary.ts) L164-179: `general` プリセットは以下を含む：
- 詳細な JSON_FORMAT（Issue #42 v2）
- 8つの出力セクション（caution, meetingInfo, agenda, topics, decisions, actionItems, importantNotes, generatedAt）
- 9つの書き方ルール
- 発言者の特定指示
- 議論の経緯追跡

Issue #136 の要望の多くが **既に実装済み**。

---

### ISSUE-5: Issue #136 の要望と現状の差分分析

| Issue #136 の要求セクション | 現在の `general` テンプレート | ギャップ |
|---|---|---|
| 1. 会議情報 | ✅ `meetingInfo` (title, participants, datetime, purpose) | なし |
| 2. 参加者（役割別） | ⚠️ `participants` は名前リストのみ | 役割別分類なし |
| 3. 議題論点 | ✅ `agenda` (箇条書き) | なし |
| 4. 主要な会話内容（時系列） | ✅ `topics` (各 title/background/currentStatus/issues/discussion/examples/nextActions) | 「時系列」の明示指示なし |
| 5. 決定事項 | ✅ `decisions` (箇条書き) | なし |
| 6. 宿題アクションアイテム | ✅ `actionItems` (task/assignee/dueDate/context) | なし |
| 7. 質疑応答（Q&A） | ❌ なし | **新規セクション必要** |
| 8. 次回に向けた進め方 | ⚠️ topics.nextActions に含まれる可能性あるが独立セクションなし | **独立セクション化が望ましい** |
| 追加ルール: 重要数値の太字 | ❌ なし | プロンプトに追加必要 |
| 追加ルール: 曖昧箇所を（要確認） | ⚠️ 「不明」「推定」は指示あるが「（要確認）」の表現なし | プロンプト調整必要 |

---

## 4. 依存関係マトリクス 📊

### 4.1 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| API `TEMPLATE_PROMPTS["general"]` | OpenAI JSON出力 | プロンプト変更で出力構造変化 | JSON_FORMAT で型を固定 |
| フロントエンド Summary 表示 | SummaryResponse 型 | 新セクション追加で表示変更必要 | 新フィールドは optional で後方互換 |
| 既存保存済み議事録 | DB の Summary データ | 新フィールドがない旧データ | optional フィールドでフォールバック |
| カスタムテンプレート | ユーザー作成のプロンプト | 旧形式で作成済みの可能性 | 影響なし（カスタムは変更しない） |

### 4.2 他 Issue との関係

| Issue | 関係 | 影響 |
|-------|------|------|
| #42 | 議事録フォーマット改善（実装済み） | #136 はその発展形 |
| #38 | 詳細画面テンプレート選択（実装済み） | テンプレート選択UIは既存 |
| #79 | ToDoリスト機能 | actionItems と関連 |

---

## 5. 修正提案（優先順位付き）

### Phase 1: デフォルトテンプレートの変更 + プロンプト強化（P0）

#### 1a. デフォルトテンプレートを `"general"` に統一

**現在**:
- メインページ初回生成: `"general"` ✅
- 詳細ページ初回生成: `"summary"` ⚠️
- 再生成ダイアログ初期値: `"summary"` ⚠️

**変更後**:
- 全ページで `"general"` をデフォルトに

#### 1b. Issue #136 の要望を `general` プロンプトに反映

API側の `TEMPLATE_PROMPTS["general"]` に以下を追加:
- 「（要確認）」表現の指示
- 重要数値の太字指示
- 参加者の役割別記載指示
- Q&A 抽出の指示（`topics` 内の `discussion` で対応 or 新フィールド）
- 時系列の流れを追える構成の明示指示

#### 1c. テンプレートID整合

フロントエンドの `"meeting"` を `"general"` に統一（または API側に `"meeting"` エイリアスを追加）。

### Phase 2: JSON_FORMAT の拡張（P1）

`nextSteps` フィールドを SummaryResponse に追加:
```json
"nextSteps": [
  "次回のアジェンダ案",
  "確認事項",
  "スケジュール"
]
```

フロントエンドの表示にも `nextSteps` セクションを追加。

### Phase 3: フロントエンド JSON_FORMAT 整合（P2）

`meetingTemplates.ts` の JSON_FORMAT を API側と同じ新形式に更新（カスタムテンプレート作成時のベースとして使用されるため）。

---

## 6. テスト戦略

| テストケース | 期待結果 |
|---|---|
| 詳細ページで「AIで生成」→ デフォルト | `general` テンプレートで詳細議事録が生成される |
| 再生成ダイアログのデフォルト | `general` が初期選択されている |
| `summary` テンプレートを選択して生成 | 従来通り簡潔要約が生成される |
| カスタムテンプレートで生成 | カスタムプロンプトがそのまま使用される |
| 既存の保存済み議事録を表示 | 新フィールド（nextSteps等）がなくてもエラーなく表示 |

---

## 7. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | デフォルトテンプレートIDを `"general"` に変更（recording/page.tsx, page.tsx） | 5分 | フロントエンド |
| 2 | API `general` プロンプトに #136 要望を反映（要確認表現、太字、Q&A指示等） | 15分 | API |
| 3 | SummaryResponse に `nextSteps` フィールド追加（API型 + フロントエンド型） | 10分 | API + Web型 |
| 4 | JSON_FORMAT に `nextSteps` セクション追加 | 5分 | API |
| 5 | フロントエンド表示に `nextSteps` セクション追加 | 10分 | Web UI |
| 6 | フロントエンド `"meeting"` → `"general"` IDマッピング整理 | 10分 | meetingTemplates.ts |
| 7 | ビルド確認・テスト | 10分 | 全体 |
| **合計** | | **約65分** | |

---

## 8. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| デフォルト変更でユーザー混乱 | 低 | 低 | `summary` テンプレートは引き続き選択可能 |
| プロンプト変更で出力品質劣化 | 低 | 中 | temperature=0.3 で安定。JSON_FORMAT で構造固定 |
| 既存保存データとの不整合 | 低 | 低 | 新フィールドは全て optional |
| max_tokens=4000 不足 | 中 | 中 | セクション追加で出力が長くなる可能性。必要に応じて増加 |

---

## 9. 結論

- **最大の問題**: デフォルトテンプレートが `"summary"`（簡潔要約）で、せっかく実装済みの詳細議事録テンプレート（`general`）がデフォルトで使われていない
- **Issue #136 の要望の大半は既に実装済み**: API側の `general` テンプレートは既に高品質。追加で必要なのは Q&A セクション、次回の進め方セクション、（要確認）表現、太字指示
- **推奨修正順序**: デフォルト変更 → プロンプト微調整 → nextSteps 追加 → ID整合
- **判定**: ✅ **GO** — 変更範囲が限定的で後方互換性も保てる
