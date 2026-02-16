# Issue #136 議事録フォーマット未反映バグ — 実装計画書

**作成日**: 2025-01-XX  
**対象Issue**: #136（議事録フォーマット改善 — 変更が反映されないバグ）  
**前提ドキュメント**: `docs/Issue136_議事録フォーマット未反映バグ_分析レビュー.md`  
**判定**: GO ✅

---

## 概要

PR #142, #143, #144 で実装した議事録フォーマット改善が、ユーザーの画面に反映されていないバグを修正する。  
根本原因は **Azure SWA の CDN キャッシュ** と **max_tokens 不足** の2点。

---

## 変更対象ファイル一覧

| # | ファイル | 変更内容 | 優先度 |
|---|---------|---------|--------|
| 1 | `web/staticwebapp.config.json` | Cache-Control ヘッダー追加 | P0 |
| 2 | `api/src/functions/summary.ts` | max_tokens 4000→8000 | P0 |
| 3 | `api/src/functions/summary.ts` | topics.content フォールバック統合 | P0 |
| 4 | `api/src/functions/summary.ts` | デバッグログ追加 | P1 |
| 5 | `web/src/lib/meetingTemplates.ts` | JSON_FORMAT を新形式に同期（任意） | P2 |

---

## Step 1: Cache-Control ヘッダー追加【P0 Critical】

### 対象ファイル
`web/staticwebapp.config.json`

### 変更内容

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

### 変更のポイント
- `globalHeaders` に `"Cache-Control": "no-cache, must-revalidate"` を追加
- `no-cache` = ブラウザはキャッシュを保持するが、使用前にサーバーに再検証を要求
- `must-revalidate` = キャッシュが期限切れの場合、必ずサーバーに確認
- これにより、デプロイ直後からユーザーに新しいアセットが配信される

### 注意事項
- Azure SWA の CDN キャッシュパージが必要な場合がある（Azure Portal から手動実行）
- パフォーマンスへの影響: HTML リクエストごとにサーバー検証が入る（304 Not Modified で軽量）
- Next.js の `_next/static/` 配下はファイル名にハッシュが含まれるため、`no-cache` でも実質的なキャッシュヒットが高い

---

## Step 2: max_tokens を 8000 に増加【P0 High】

### 対象ファイル
`api/src/functions/summary.ts`

### 変更箇所（L335付近）

```typescript
// Before
const response = await client.chat.completions.create({
  model: deploymentName,
  messages: [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `以下の文字起こしテキストから議事録を作成してください：\n\n${body.transcript}`,
    },
  ],
  temperature: 0.3,
  max_tokens: 4000,
  response_format: { type: "json_object" },
});

// After
const response = await client.chat.completions.create({
  model: deploymentName,
  messages: [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `以下の文字起こしテキストから議事録を作成してください：\n\n${body.transcript}`,
    },
  ],
  temperature: 0.3,
  max_tokens: 8000,
  response_format: { type: "json_object" },
});
```

### 理由
- 新8セクション構成（topics.content自由記述 + qaItems + nextSteps）は旧3フィールド構成の2〜4倍のトークンが必要
- 4000トークン ≈ 日本語1300〜2000文字 → 8セクション × 各150〜300文字 = 3000〜5000トークン
- 8000トークンで十分なマージンを確保
- gpt-5-mini のコンテキストウィンドウは十分大きいため、8000でも問題なし

---

## Step 3: topics.content フォールバック統合【P0 High】

### 対象ファイル
`api/src/functions/summary.ts`

### 変更箇所（L380-397付近、topicsのマッピング部分）

```typescript
// Before
topics: (parsedSummary.topics || []).map((topic: {
  title?: string;
  content?: string;
  background?: string;
  currentStatus?: string;
  issues?: string;
  discussion?: string;
  examples?: string;
  nextActions?: string;
}) => ({
  title: topic.title || "",
  content: topic.content || "",
  // 旧形式フィールドも保持（後方互換）
  background: topic.background || "",
  currentStatus: topic.currentStatus || "",
  issues: topic.issues || "",
  discussion: topic.discussion || "",
  examples: topic.examples || "",
  nextActions: topic.nextActions || "",
})),

// After
topics: (parsedSummary.topics || []).map((topic: {
  title?: string;
  content?: string;
  background?: string;
  currentStatus?: string;
  issues?: string;
  discussion?: string;
  examples?: string;
  nextActions?: string;
}) => {
  // 旧形式フィールドを content に統合（LLMが旧形式で出力した場合のフォールバック）
  const legacyContent = [
    topic.background && `【背景】${topic.background}`,
    topic.currentStatus && `【現状】${topic.currentStatus}`,
    topic.issues && `【課題】${topic.issues}`,
    topic.discussion && `【議論】${topic.discussion}`,
    topic.examples && `【具体例】${topic.examples}`,
    topic.nextActions && `【次のアクション】${topic.nextActions}`,
  ].filter(Boolean).join("\n");

  return {
    title: topic.title || "",
    content: topic.content || legacyContent || "",
    // 旧形式フィールドも保持（後方互換）
    background: topic.background || "",
    currentStatus: topic.currentStatus || "",
    issues: topic.issues || "",
    discussion: topic.discussion || "",
    examples: topic.examples || "",
    nextActions: topic.nextActions || "",
  };
}),
```

### 理由
- LLMが旧形式（background/discussion等）で出力した場合、`content` が空になる
- フロントエンドは `topic.content ? 新表示 : 旧表示` の分岐だが、旧表示でも各フィールドが空なら何も表示されない
- 旧フィールドを `content` に統合することで、フロントエンドは常に `topic.content` を参照すれば良くなる
- これにより、LLMの出力形式に関わらず確実に表示される

---

## Step 4: デバッグログ追加【P1 Medium】

### 対象ファイル
`api/src/functions/summary.ts`

### 変更箇所（L340付近、LLMレスポンス取得後）

```typescript
const content = response.choices[0]?.message?.content;

// デバッグログ: LLM出力の構造確認
if (content) {
  const usage = response.usage;
  console.log(`[Summary] template=${body.templateId || 'default'}, model=${deploymentName}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}, total_tokens=${usage?.total_tokens}, output_length=${content.length}`);
  
  try {
    const preview = JSON.parse(content);
    const topicCount = preview.topics?.length || 0;
    const hasContent = preview.topics?.some((t: { content?: string }) => t.content) || false;
    const qaCount = preview.qaItems?.length || 0;
    console.log(`[Summary] topics=${topicCount}, hasContent=${hasContent}, qaItems=${qaCount}, hasNextSteps=${!!preview.nextSteps?.length}`);
  } catch {
    console.log(`[Summary] WARNING: Failed to preview parsed structure`);
  }
}
```

### 理由
- 今後同様の「LLMが期待通りの出力をしない」問題が発生した場合、ログから即座に原因を特定できる
- トークン使用量を監視することで max_tokens の適正値を継続的に判断できる

---

## Step 5: meetingTemplates.ts の JSON_FORMAT 同期【P2 Low — 任意】

### 対象ファイル
`web/src/lib/meetingTemplates.ts`

### 方針
フロントエンド側の `JSON_FORMAT`（L4-41）を API 側の新 JSON_FORMAT（8セクション構成）に置き換える。  
ただし、現在プリセットテンプレートの `systemPrompt` は API に送信されないため、即座の影響はない。  
将来のカスタムテンプレート作成時のリファレンスとして同期しておく。

### 判断
- この修正は任意。Phase 1-3 の修正で十分に機能する。
- 将来的にプリセットの `systemPrompt` を `customPrompt` として送信する設計変更がある場合は必須。

---

## デプロイ後の確認手順

### 即座の確認（デプロイ直後）

1. **ブラウザキャッシュクリア** + ハードリロード（Ctrl+Shift+R）
2. DevTools → Network タブ → Response Headers で `Cache-Control: no-cache, must-revalidate` を確認
3. 適当な録音で「議事録」テンプレートを選択 → 「議事録を生成」
4. 以下を確認：
   - [ ] セクションヘッダーが「3. 主要な会話内容」(ja) になっている
   - [ ] 各 topic に content（自由記述テキスト）が表示されている
   - [ ] 「6. 質疑応答」セクションが表示されている（Q&Aがある場合）
   - [ ] 「7. 次回に向けた進め方」セクションが表示されている
   - [ ] 参加者に役割が付与されている（(発言者)等）
5. コピー機能で新形式のマークダウンが出力されることを確認

### Azure Portal での確認（必要に応じて）

1. Azure SWA リソース → 概要 → 「Purge CDN cache」でキャッシュパージ
2. Azure Functions → ログストリーム → `[Summary]` ログでトークン使用量を確認

---

## ブランチ名・コミットメッセージ

```
ブランチ: fix/issue-136-cache-and-tokens
コミット: fix: add Cache-Control headers and increase max_tokens for Issue #136 format
```

---

## まとめ

| # | 修正 | 工数 | リスク | 効果 |
|---|------|------|--------|------|
| 1 | Cache-Control ヘッダー | 5分 | 極低 | 🔴 根本原因解消 |
| 2 | max_tokens 8000 | 1分 | 極低 | 🔴 出力品質確保 |
| 3 | content フォールバック | 10分 | 低 | 🟡 ロバスト性向上 |
| 4 | デバッグログ | 10分 | 極低 | 🟢 将来のデバッグ効率化 |
| 5 | meetingTemplates.ts 同期 | 20分 | 低 | 🟢 保守性向上 |

**合計工数**: 約30〜45分（Step 1-4）

**実装開始コマンド**:
```
@EngineerDeploy Issue #136 のバグ修正を実装してデプロイして（実装計画書: docs/Issue136_議事録フォーマット未反映バグ_実装計画書.md）
```
