# Issue #136 議事録フォーマット変更が反映されないバグ — 分析レビュー

**作成日**: 2025-01-XX  
**対象Issue**: #136（議事録フォーマット改善）  
**関連PR**: #142, #143, #144（すべてマージ済み）  
**ステータス**: 🔴 Critical Bug — 3回のデプロイ後も変更が反映されない

---

## 1. エグゼクティブサマリー

- **問題の本質**: PR #142, #143, #144 で API（プロンプト・JSON構造）と フロントエンド（レンダリング・i18n）を3回に分けて改修しマージしたが、ユーザーの画面では**旧フォーマットのまま**表示されている。
- **影響範囲**: 議事録生成機能を使う全ユーザー（100%）に影響。新フォーマット（8セクション構成・Q&A・content形式topics）が一切表示されない。
- **修正の緊急度**: **Critical（P0）** — 3回のリリースが無効化されている状態。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
[ユーザー操作]
    │
    ▼
[Frontend: page.tsx / recording/page.tsx]
    │  selectedTemplateId = "general"
    │  summaryApi.generateSummary({ templateId: "general" })
    │
    ▼
[SummaryApiService] (web/src/services/summaryApi.ts)
    │  POST /api/summary/generate
    │  body: { transcript, language, templateId: "general" }
    │  ※ preset templates は customPrompt を送信しない
    │
    ▼
[Azure Functions: summary.ts]
    │  resolveSystemPrompt("general", undefined)
    │  → TEMPLATE_PROMPTS["general"] を使用
    │  → Azure OpenAI gpt-5-mini に送信
    │
    ▼
[Azure OpenAI API]
    │  response_format: { type: "json_object" }
    │  max_tokens: 4000
    │  temperature: 0.3
    │
    ▼
[API: レスポンスパース]
    │  JSON.parse → SummaryResponse にマッピング
    │  topics.content, qaItems を抽出
    │
    ▼
[Frontend: レンダリング]
    ├─ topic.content ? → 新形式表示
    ├─ else → 旧形式 (background/discussion...) フォールバック
    ├─ qaItems → Q&Aセクション表示
    └─ i18n: topicDetails → "3. 主要な会話内容"
```

### 2.2 データフロー

```
[入力] transcript テキスト
    ↓
[API] resolveSystemPrompt() → TEMPLATE_PROMPTS["general"]
    ↓ (新プロンプト: "あなたは最強の議事録作成者です…" + JSON_FORMAT v3)
[LLM] → JSON出力 { meetingInfo, agenda, topics:[{title,content}], qaItems, ... }
    ↓
[API] パース → SummaryResponse オブジェクト
    ↓
[Frontend] response.data → setSummary() / updateRecording()
    ↓
[UI] summary.topics.map() → topic.content 判定 → レンダリング
```

### 2.3 二重定義されている JSON_FORMAT

| 場所 | ファイル | 構造 | 用途 |
|------|---------|------|------|
| **API側（新）** | `api/src/functions/summary.ts` L88-170 | 8セクション: `topics:[{title,content}]`, `qaItems` | LLMプロンプトに埋め込み |
| **Frontend側（旧）** | `web/src/lib/meetingTemplates.ts` L4-41 | 3フィールド: `overview`, `keyPoints`, `actionItems` | preset の `systemPrompt` 内で使用（ただし API には送信されない） |

---

## 3. 重大バグ分析 🔴

### BUG-1: フロントエンドの静的アセットがキャッシュされ旧バージョンが表示される【Critical】

**場所**: `web/staticwebapp.config.json` + Azure SWA CDN + ブラウザキャッシュ  

**問題**:  
ユーザーの画面に「Topic Details」というセクションヘッダーが表示されている。これは PR #144 以前の旧 i18n 値。  

| i18nキー | PR#144以前 (en) | PR#144以後 (en) | PR#144以後 (ja) | ユーザー表示 |
|---------|----------------|----------------|----------------|------------|
| `topicDetails` | "Topic Details" | "3. Key Discussions" | "3. 主要な会話内容" | **"Topic Details"** ← 旧値 |

さらに、PR #144 で追加した以下のフロントエンドコードが動作していない：
- `topic.content` の判定分岐（新形式レンダリング）
- `qaItems` セクションの表示
- セクション番号の付与（"3. 主要な会話内容" → "Topic Details"）

**証拠**:
1. ✅ API側の変更は動作している（参加者に役割「(発言者)」「(お客様側)」が付与、数値の太字表示）
2. ❌ フロントエンド側の変更は反映されていない（旧ラベル、topic.content未使用、qaItems非表示）

**根本原因**:  
`web/staticwebapp.config.json` に Cache-Control ヘッダーが設定されていない。Azure SWA の CDN がデフォルトキャッシュ（最大数時間〜1日）を適用し、Next.js の静的エクスポート（`output: "export"`）のJSバンドル・HTMLがキャッシュされたまま。

```json
// 現在の staticwebapp.config.json — Cache-Control 設定なし
"globalHeaders": {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // ← Cache-Control が存在しない
}
```

**影響**: 全ユーザーの100%。フロントエンドの全変更（i18n、レンダリングロジック、新セクション）が無効化。  

**修正方針**:
1. `staticwebapp.config.json` に適切な Cache-Control ヘッダーを追加
2. HTML/JS に `no-cache` または短い `max-age` を設定
3. ハッシュ付きアセット（`_next/static/*`）には長期キャッシュ（immutable）を設定

```json
{
  "routes": [
    {
      "route": "/*.html",
      "headers": {
        "Cache-Control": "no-cache, must-revalidate"
      }
    },
    {
      "route": "/index.html",
      "headers": {
        "Cache-Control": "no-cache, must-revalidate"
      }
    }
  ],
  "globalHeaders": {
    "Cache-Control": "no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "microphone=(self)"
  }
}
```

---

### BUG-2: max_tokens: 4000 が新フォーマットに対して不十分【High】

**場所**: `api/src/functions/summary.ts` L335  

**コード**:
```typescript
const response = await client.chat.completions.create({
  model: deploymentName,
  messages: [...],
  temperature: 0.3,
  max_tokens: 4000,  // ← ここ
  response_format: { type: "json_object" },
});
```

**問題**:  
新フォーマットは8セクション構成で、各topicに `content`（自由記述の長文）、`qaItems`（Q&A）、`nextSteps` を含む。旧フォーマット（3フィールド: overview, keyPoints, actionItems）と比べて出力量が2〜4倍。  

4000トークン ≈ 日本語1300〜2000文字。8セクション × 各セクション150〜300文字 = 1200〜2400文字 + JSONメタデータ ≈ 3000〜5000トークン。

`response_format: { type: "json_object" }` 使用時、トークン上限に達すると：
- モデルはJSON閉じ括弧を優先して出力
- 後半セクション（`qaItems`, `nextSteps`）が空配列になる
- `topics.content` が途中で切れるか空文字になる

**影響**: 長い会議の議事録で、topics の content が空、Q&A セクションが欠落、nextSteps が空になる可能性。  

**修正方針**:
```typescript
max_tokens: 8000,  // 4000 → 8000 に増加
```

---

### BUG-3: topic.content が空文字列でも旧形式フォールバックが空表示になる【Medium】

**場所**:  
- `web/src/app/page.tsx` L1361-1385 (レンダリング)  
- `web/src/app/recording/page.tsx` L1158-1182 (レンダリング)  
- `web/src/app/page.tsx` L562-573 (コピー関数)  
- `web/src/app/recording/page.tsx` L370-381 (コピー関数)  

**コード（レンダリング）**:
```tsx
{topic.content ? (
  // 新形式: content をそのまま表示
  <div>{topic.content}</div>
) : (
  // 旧形式フォールバック: background, discussion 等を表示
  <div>
    {topic.background && (...)}
    {topic.discussion && (...)}
  </div>
)}
```

**コード（APIパース）**:
```typescript
content: topic.content || "",    // undefined → ""
background: topic.background || "", // undefined → ""
```

**問題**:  
LLM が新形式 `{title, content}` で出力した場合、旧フィールド（`background`, `discussion`等）は存在しない → `undefined` → API パースで `""` に変換。  
LLM が旧形式 `{title, background, discussion, ...}` で出力した場合、`content` は存在しない → `undefined` → `""` に変換。

→ `topic.content` が `""` (falsy) の場合、旧形式フォールバックに入るが、旧フィールドも `""` なので **何も表示されない**。

**影響**: LLMの出力形式にかかわらず、content が空の場合にtopicが「タイトルだけ」で表示される「空Topics」状態が発生。  

**修正方針**:
```typescript
// API側: content が空で旧フィールドがある場合、旧フィールドを content に統合
content: topic.content || 
  [topic.background, topic.currentStatus, topic.discussion, topic.issues, topic.nextActions]
    .filter(Boolean)
    .join("\n") || "",
```

---

## 4. 設計上の問題 🟡

### DESIGN-1: JSON_FORMAT の二重定義【High】

**場所**:
- `api/src/functions/summary.ts` L88-170 — 新 JSON_FORMAT（8セクション構成）
- `web/src/lib/meetingTemplates.ts` L4-41 — 旧 JSON_FORMAT（3フィールド構成）

**問題**:  
フロントエンドの `meetingTemplates.ts` にある旧 `JSON_FORMAT` は、各 PRESET_TEMPLATES の `systemPrompt` 内で使用されている（`one-on-one`, `sales`, `dev-sprint`, `brainstorm`）。  
現在、プリセットテンプレートの場合は `customPrompt` を送信しない（`templateId` のみ）ため、API 側の `TEMPLATE_PROMPTS` が使用される。  
**しかし**、フロントエンドの preset `systemPrompt` とAPI側の `TEMPLATE_PROMPTS` の JSON 構造が完全に不一致：

| テンプレート | Frontend systemPrompt | API TEMPLATE_PROMPTS | 一致? |
|------------|----------------------|---------------------|------|
| `general` | 旧形式(overview/keyPoints/actionItems) | **新形式(8セクション)** | ❌ |
| `one-on-one` | 旧形式 | 新形式 JSON_FORMAT | ❌ |
| `sales` | 旧形式 | 新形式 JSON_FORMAT | ❌ |
| `dev-sprint` | 旧形式 | 新形式 JSON_FORMAT | ❌ |
| `brainstorm` | 旧形式 | 新形式 JSON_FORMAT | ❌ |

これは現在「たまたま動く」状態。将来的にプリセットの `systemPrompt` を `customPrompt` として送信するロジックに変更した場合、旧形式が適用されて全壊する。

**修正方針**: フロントエンドの `meetingTemplates.ts` の `JSON_FORMAT` と各 preset の `systemPrompt` を API 側と同期するか、プリセットの `systemPrompt` を削除して API 側に一元管理する。

---

### DESIGN-2: LLM出力のバリデーション不在【Medium】

**場所**: `api/src/functions/summary.ts` L356-430  

**問題**:  
`JSON.parse(content)` の後、各フィールドは `|| ""` / `|| []` でフォールバックされるが、**LLM が期待構造を返したかの検証がない**。  
例: `topics` が配列でない場合、`qaItems` が存在しない場合、`content` フィールドが全 topics で空の場合 — いずれもサイレントに空データとして通過する。

**修正方針**: 構造検証ログを追加し、期待外の出力時に警告 + フォールバック処理を実装。

---

### DESIGN-3: APIデバッグ用ログの不足【Medium】

**場所**: `api/src/functions/summary.ts` L340-350  

**問題**:  
LLM の生出力がログに残らないため、「LLM が何を返したか」がデプロイ後に確認できない。  
今回のバグ調査でも「LLMが新形式を返しているのか旧形式なのか」が不明で、原因特定に時間を要した。

**修正方針**:
```typescript
const content = response.choices[0]?.message?.content;
// デバッグログ（本番では縮小版）
console.log(`[Summary] template=${body.templateId}, tokens=${response.usage?.total_tokens}, output_len=${content?.length}`);
```

---

### ✅ Good: API 側のプロンプト設計

`TEMPLATE_PROMPTS["general"]` のプロンプト設計は優秀：
- 自然言語の指示（8セクション見出し）と JSON_FORMAT の構造指示が明確に分離
- 書き方ルール（事実ベース、推測禁止、太字など）が具体的
- `response_format: { type: "json_object" }` と組み合わせて確実なJSON出力

### ✅ Good: 後方互換性の配慮

新旧両形式に対応するパース・レンダリングのフォールバック設計は適切。旧形式の summary データでもクラッシュしない。

---

## 5. 依存関係マトリクス 📊

### 5.1 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| Frontend (SWA) | Azure CDN | **CDN キャッシュで旧版配信** | Cache-Control ヘッダー設定 |
| Frontend (JS) | ブラウザキャッシュ | **旧バンドルがキャッシュ** | no-cache ヘッダー + 強制リロード案内 |
| API (Functions) | Azure Functions ランタイム | コールドスタート遅延 | Health check で確認済み |
| LLM 出力 | max_tokens | **4000トークン上限で出力切れ** | 8000+ に増加 |
| LLM 出力 | JSON_FORMAT 指示 | LLM が構造に従わない可能性 | バリデーション追加 |

### 5.2 他 Issue との相互作用

| Issue | 相互作用 | リスク |
|-------|---------|--------|
| #42 (議事録v2) | JSON_FORMAT の旧版がフロントエンドに残存 | meetingTemplates.ts の不整合 |
| #38 (テンプレート選択) | templateId の送信ロジック | 現在は問題なし |
| #106 (カスタムテンプレート) | customPrompt 送信時は旧 JSON_FORMAT が使用される | 要同期 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Azure SWA CDN | キャッシュ設定なし | **旧版が長時間配信される** |
| Chrome/Edge | Service Worker なし | ブラウザキャッシュのみ |
| Safari/iOS | 同上 | 同上 |
| Next.js Static Export | ハッシュ付きチャンク生成 | HTML がキャッシュされるとハッシュ付きチャンクへの参照が古いまま |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### Fix-1: Cache-Control ヘッダー追加 [Critical]

**対象ファイル**: `web/staticwebapp.config.json`

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/images/*.{png,jpg,gif}", "/css/*", "/api/*"]
  },
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    }
  ],
  "responseOverrides": {
    "401": {
      "statusCode": 302,
      "redirect": "/.auth/login/aad"
    }
  },
  "globalHeaders": {
    "Cache-Control": "no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "microphone=(self)"
  },
  "platform": {
    "apiRuntime": "node:20"
  }
}
```

**理由**: HTML/JS にデフォルトの CDN キャッシュが適用されているため、デプロイ後も旧バージョンが配信され続ける。`no-cache` はリクエスト時にサーバーに再検証を要求するため、新しいデプロイがあればすぐに反映される。

#### Fix-2: max_tokens を 8000 に増加 [High]

**対象ファイル**: `api/src/functions/summary.ts` L335

```typescript
// Before
max_tokens: 4000,

// After
max_tokens: 8000,
```

**理由**: 新8セクション構成では、topics の content（自由記述長文） + qaItems + nextSteps で旧形式の2〜4倍のトークンが必要。4000トークンでは後半セクションが切り捨てられる。

#### Fix-3: topics.content のフォールバック強化 [High]

**対象ファイル**: `api/src/functions/summary.ts` L385-397

```typescript
// Before
content: topic.content || "",

// After — 旧形式フィールドがある場合は content に統合
content: topic.content || 
  [
    topic.background && `【背景】${topic.background}`,
    topic.currentStatus && `【現状】${topic.currentStatus}`,
    topic.issues && `【課題】${topic.issues}`,
    topic.discussion && `【議論】${topic.discussion}`,
    topic.examples && `【具体例】${topic.examples}`,
    topic.nextActions && `【次のアクション】${topic.nextActions}`,
  ].filter(Boolean).join("\n") || "",
```

**理由**: LLM が旧形式で出力した場合、`content` は空になるが旧フィールドにデータがある。この場合、旧フィールドを `content` に統合することで、フロントエンドは常に `topic.content` を表示すれば良くなる。

### Phase 2: 設計改善（P1）

#### Fix-4: フロントエンド meetingTemplates.ts の JSON_FORMAT 同期 [Medium]

**対象ファイル**: `web/src/lib/meetingTemplates.ts`

フロントエンドの `PRESET_TEMPLATES` の `systemPrompt` を API 側の新 JSON_FORMAT と同期させる。  
または、プリセットの `systemPrompt` を完全に削除して「API側で一元管理」とする。

**推奨**: プリセットの `systemPrompt` は残すが、JSON_FORMAT を新形式に更新。  
理由: カスタムテンプレート作成時のリファレンスとしてフロントエンドにも保持しておく価値がある。

#### Fix-5: LLM出力の構造バリデーション追加 [Medium]

**対象ファイル**: `api/src/functions/summary.ts`

```typescript
// パース後にバリデーション
const parsedSummary = JSON.parse(content);

// 構造検証
const hasNewTopicFormat = parsedSummary.topics?.some((t: any) => t.content);
const hasOldTopicFormat = parsedSummary.topics?.some((t: any) => t.background || t.discussion);
console.log(`[Summary] format=${hasNewTopicFormat ? 'new' : hasOldTopicFormat ? 'old' : 'empty'}, topics=${parsedSummary.topics?.length || 0}, qaItems=${parsedSummary.qaItems?.length || 0}`);
```

### Phase 3: 堅牢性強化（P2）

#### Fix-6: APIデバッグログ追加 [Low]

```typescript
console.log(`[Summary] template=${body.templateId}, model=${deploymentName}, usage=${JSON.stringify(response.usage)}`);
```

#### Fix-7: フロントエンドにビルドバージョン表示 [Low]

デプロイ確認用に、フッター等にビルド日時またはコミットハッシュを表示。

---

## 8. テスト戦略

### 手動テスト（デプロイ後）

| ステップ | 操作 | 期待結果 |
|---------|------|---------|
| 1 | ブラウザキャッシュクリア + ハードリロード | 新しいJSバンドルがダウンロードされる |
| 2 | 「議事録」テンプレート選択 → 生成 | 8セクション構成で表示 |
| 3 | topics 内の content 確認 | 各topicにcontent（自由記述）が表示 |
| 4 | Q&A セクション確認 | 「6. 質疑応答」が表示される |
| 5 | セクションヘッダー確認 | "3. 主要な会話内容" (ja) が表示 |
| 6 | コピー機能 | 新形式のマークダウンがコピーされる |
| 7 | 長文会議（10分+）で生成 | 全セクションが埋まる（max_tokens十分） |

### API テスト

| テスト | 方法 | 期待結果 |
|-------|------|---------|
| LLM出力構造確認 | API ログで確認 | `topics[].content` が空でない |
| トークン使用量確認 | `response.usage` ログ | 4000未満で収まるか確認 |
| 旧形式互換テスト | 旧summaryデータの表示 | クラッシュせず旧形式で表示 |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 | 優先度 |
|------|---------|--------|---------|--------|
| 1 | Cache-Control ヘッダー追加 | 5分 | staticwebapp.config.json | P0 |
| 2 | max_tokens 4000→8000 | 1分 | api/summary.ts | P0 |
| 3 | topics.content フォールバック強化 | 10分 | api/summary.ts | P0 |
| 4 | meetingTemplates.ts JSON_FORMAT 同期 | 20分 | meetingTemplates.ts | P1 |
| 5 | LLM出力バリデーション/ログ追加 | 15分 | api/summary.ts | P1 |
| 6 | ビルドバージョン表示 | 10分 | フッターコンポーネント | P2 |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Cache-Control 追加後もCDNキャッシュが残る | 中 | 高 | Azure SWA の CDN パージを手動実行 |
| max_tokens 増加でAPIコスト増 | 低 | 低 | 8000は適正範囲。モニタリングで確認 |
| LLM が新JSON構造に従わない | 低 | 中 | フォールバック統合で両形式対応済み |
| 旧summaryデータとの互換性破壊 | 極低 | 高 | 後方互換ロジック維持済み |

---

## 11. 結論

### 最大の問題点

**フロントエンドの静的アセットに Cache-Control が設定されておらず、Azure SWA の CDN がデフォルトキャッシュを適用。3回のデプロイ（PR #142, #143, #144）の変更がすべてキャッシュに阻まれてユーザーに届いていない。**

加えて、`max_tokens: 4000` が新8セクション構成に対して不十分であり、LLM の出力が途中で切り捨てられる可能性がある。

### 推奨する修正順序

1. **Cache-Control ヘッダー追加**（staticwebapp.config.json）— 根本原因の解消
2. **max_tokens 増加**（4000→8000）— 出力品質の確保
3. **topics.content フォールバック強化**（旧形式→content統合）— ロバスト性向上
4. **meetingTemplates.ts 同期** — 将来のリスク排除
5. **ログ/バリデーション追加** — 今後のデバッグ効率化

### 判定: **GO** ✅

修正内容は低リスクかつ明確。主な修正は設定ファイル1行の追加（Cache-Control）と、max_tokens の数値変更。即座に実装・デプロイ可能。
