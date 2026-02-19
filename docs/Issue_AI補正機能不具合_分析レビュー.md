# AI補正機能不具合 - 深掘り分析レビュー

**対象機能**: 文字起こしAI補正 / 翻訳AI補正 / リアルタイム文字起こし補正  
**報告日**: 2026-02-19  
**関連Issue**: #70 (LLM文字起こし補正), #125 (翻訳AI補正), #126 (リアルタイムAI補正)

---

## 1. エグゼクティブサマリー

- **文字起こしAI補正（保存後）**: API は正常動作しているが、**補正結果が `fullText` のみに適用され `segments` が未補正のまま**のため、セグメント表示モードではユーザーに補正が見えない（**重大バグ**）
- **翻訳AI補正**: **未実装**。Issue #125 がオープンのまま（P3）
- **リアルタイムAI補正**: API は正常動作しているが、**デフォルトで無効**（`false`）であり、ユーザーが設定画面で手動有効化しない限り機能しない
- **影響範囲**: 全ユーザーの録音詳細画面でAI補正版が見えない（100%影響）
- **緊急度**: **High** — コア機能の表示バグ

---

## 2. アーキテクチャ概観

### 2.1 AI補正のコンポーネント依存関係

```
┌─────────────────────────────────────────────────────────────────────┐
│                        フロントエンド (web/)                         │
│                                                                     │
│  page.tsx (メイン)                                                  │
│   ├── useRealtimeCorrection.ts ──→ correctionApi.ts                │
│   │     [リアルタイム補正: 5セグ/3秒デバウンス/50回上限]            │
│   │     enabled: settings.enableRealtimeCorrection ?? false ❌       │
│   │                                                                 │
│   └── handleSaveWithTitle()                                         │
│         ├── recordingsApi.createRecording() ──→ POST /api/recordings│
│         └── 保存ペイロードに transcript + translations を含む       │
│                                                                     │
│  recording/page.tsx (詳細)                                          │
│   ├── transcriptView: "original" | "corrected"                     │
│   ├── displayTranscript → segments.map(s => s.text) 🔴              │
│   │    ↑ correctedTranscript.segments は原文のまま！                │
│   ├── correctionStatusBadge (ポーリング: 3秒)                      │
│   └── handleRetryCorrection() ──→ POST /recordings/{id}/correct    │
│                                                                     │
│  settings/page.tsx                                                  │
│   └── enableRealtimeCorrection トグル                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        バックエンド (api/)                           │
│                                                                     │
│  recordings.ts                                                      │
│   ├── POST /recordings → createRecording()                         │
│   │    └── processTranscriptCorrection() [fire-and-forget]         │
│   └── POST /recordings/{id}/correct → 手動リトライ                 │
│                                                                     │
│  transcriptCorrectionService.ts                                     │
│   ├── correctTranscript(transcript, language)                      │
│   │    ├── Azure OpenAI (gpt-5-mini, temp=0.3)                    │
│   │    └── return { segments: transcript.segments, 🔴               │
│   │                 fullText: correctedText }                      │
│   │         ↑ セグメントを原文のままコピー！                       │
│   └── processTranscriptCorrection(id, userId)                      │
│        └── Cosmos DB patch → correctedTranscript, correctionStatus │
│                                                                     │
│  realtimeCorrection.ts                                              │
│   └── POST /correction/realtime                                    │
│        └── Azure OpenAI (gpt-5-mini, temp=0.2, json_object)       │
│        ✅ API動作確認済み                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 データフロー図

```
[録音中]
  ↓ useSpeechRecognition → segments (LiveSegment[])
  ↓ useRealtimeCorrection → correctedText を segments に反映（有効時のみ）
  ↓ handleSaveWithTitle()
  ↓   transcript.fullText = labeledSegments.map(s => s.text).join(" ")
  ↓   ※ correctedText があれば fullText に反映済み
  ↓
[POST /api/recordings]
  ↓ recordingService.createRecording()
  ↓   correctionStatus: "pending"
  ↓   processTranscriptCorrection() [fire-and-forget]
  ↓     → correctTranscript()
  ↓       → Azure OpenAI で fullText のみ補正
  ↓       → return { segments: 原文のまま ❌, fullText: 補正済 ✅ }
  ↓     → Cosmos DB に correctedTranscript を保存
  ↓
[GET /api/recordings/{id}]
  ↓ 詳細画面でポーリング
  ↓ correctionStatus === "completed"
  ↓ correctedTranscript を受け取り
  ↓
[録音詳細画面]
  ↓ transcriptView === "corrected"
  ↓ displayTranscript = recording.correctedTranscript
  ↓ displayTranscript.segments.map(s => s.text) ← 原文のまま表示 🔴
```

---

## 3. 重大バグ分析 🔴

### BUG-1: 保存後AI補正が表示上見えない（Critical）

**場所**: [transcriptCorrectionService.ts](../api/src/services/transcriptCorrectionService.ts#L62-L65)  
**コード**:
```typescript
// セグメントは元のまま、fullText のみ補正版に置き換え
return {
  segments: transcript.segments,  // ← 原文のまま！
  fullText: correctedText,
};
```

**問題**: `correctTranscript()` が `fullText` のみを補正し、`segments` を原文のままコピーしている。録音詳細画面ではセグメント表示が優先されるため（`displayTranscript.segments.length > 0` のとき）、**ユーザーには補正結果が全く見えない**。

**影響**: 全ユーザー。AI補正版タブに切り替えても原文と同一のテキストが表示され、「AI補正が動いていない」と見える。

**根本原因**: 初期実装時に `fullText` レベルの補正で十分と判断し、セグメント単位の補正を省略した。しかし UI はセグメント表示を優先するため、表示上は差異が出ない。

**表示フロー**:
```
recording/page.tsx L1113:
  displayTranscript.segments.map((segment) => {
    <span>{segment.text}</span>  // ← correctedTranscript.segments.text = 原文
  })
```

**修正方針**:

方針A（推奨）: `correctTranscript()` でセグメント単位の補正も行う
```typescript
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  // ... Azure OpenAI 呼び出し ...
  const correctedText = response.choices[0]?.message?.content?.trim();
  
  // セグメント単位でも補正テキストを反映
  // fullText の差分からセグメントへのマッピングは困難なため、
  // 各セグメントを個別に補正するか、LLM にセグメント単位の出力を要求
  return {
    segments: await correctSegments(transcript.segments, language, client, deploymentName),
    fullText: correctedText,
  };
}
```

方針B（簡易）: 詳細画面で `segments` がない場合は `fullText` を表示する既存フォールバックを活用し、`correctedTranscript` の `segments` を空配列にする
```typescript
return {
  segments: [],  // ← セグメントなしにすれば fullText がフォールバック表示される
  fullText: correctedText,
};
```

方針C（最も影響少）: 詳細画面のセグメント表示で `correctedTranscript` の場合は `fullText` を表示する
```tsx
// recording/page.tsx のセグメント表示部分
{transcriptView === "corrected" && recording?.correctedTranscript ? (
  <div className="whitespace-pre-wrap text-gray-800 p-2">
    {displayTranscript.fullText}
  </div>
) : (
  displayTranscript.segments.map(...) // セグメント表示
)}
```

---

### BUG-2: 翻訳AI補正が未実装（High）

**場所**: N/A（コードが存在しない）  
**問題**: Issue #125 は「翻訳テキストの保存後AI補正機能」として起票されているが、**実装されていない**。

**影響**: 翻訳テキストに対するAI補正機能が全く利用できない。

**根本原因**: Issue #125 は P3 の enhancement として残っており、まだ開発着手されていない。

**現状**:
- `Recording` 型に `correctedTranslations` フィールドが**未定義**
- API に翻訳補正エンドポイントが**存在しない**
- 録音詳細の翻訳タブに「オリジナル/AI補正版」切り替えが**ない**

**修正方針**: Issue #125 を実装する。文字起こし補正（Issue #70）と同様のパターンで:
1. `Recording` 型に `correctedTranslations` を追加
2. `transcriptCorrectionService.ts` に `correctTranslation()` を追加
3. `recordingService.ts` の保存時に翻訳補正も fire-and-forget で実行
4. 録音詳細の翻訳タブに切り替えUIを追加

---

### BUG-3: リアルタイムAI補正がデフォルトOFF（Medium）

**場所**: [types/index.ts](../web/src/types/index.ts#L199)  
**コード**:
```typescript
enableRealtimeCorrection?: boolean;  // Issue #126
```

[page.tsx](../web/src/app/page.tsx#L289):
```typescript
const enableRealtimeCorrection = settings.enableRealtimeCorrection ?? false;
```

**問題**: `enableRealtimeCorrection` の初期値が `false` であり、**ユーザーが設定画面で手動で有効にしない限りリアルタイム補正は動作しない**。設定画面での説明も十分でないため、ユーザーが機能の存在に気づかない。

**影響**: 設定を変更していない全ユーザー（≈99%）でリアルタイム補正が無効。

**根本原因**: コスト・API呼び出し回数の制御のため意図的にデフォルトOFFにしているが、ユーザー体験としては「動いていない」と感じる。

**修正方針**:
- 最低限: 録音画面にリアルタイム補正のON/OFFインジケーターを表示し、設定画面への誘導リンクを追加
- 推奨: デフォルトをONにしつつ、API呼び出し回数を低めに設定（例: 20回/セッション）

---

## 4. 設計上の問題 🟡

### DESIGN-1: correctedTranscript のセグメント同期問題

**場所**: [transcriptCorrectionService.ts](../api/src/services/transcriptCorrectionService.ts#L62-L65)  
**問題**: `correctedTranscript` が `fullText` のみ補正し `segments` を原文コピーするため、セグメントと全文テキストの不整合が発生する。

**改善案**: LLM にセグメント単位の補正を要求するか、全文補正結果をセグメントにマッピングするアルゴリズムを導入する。

### DESIGN-2: 補正の二重実行リスク

**場所**: [recordingService.ts](../api/src/services/recordingService.ts#L43), [page.tsx](../web/src/app/page.tsx#L746-L748)  
**問題**: リアルタイム補正（Issue #126）が有効な場合、保存時に `correctedText` が `text` に統合される。その後サーバー側で `processTranscriptCorrection()` が再度 LLM 補正を実行するため、**既に補正済みのテキストが二重補正される**。

**改善案**: 保存ペイロードにリアルタイム補正済みフラグを含め、サーバー側で二重補正を回避する。

### DESIGN-3: Fire-and-forget の error swallowing

**場所**: [recordingService.ts](../api/src/services/recordingService.ts#L43-L45)  
```typescript
processTranscriptCorrection(result.id, result.userId).catch((err) => {
  console.error(`[Correction] Failed to start for ${result.id}:`, err);
});
```
**問題**: 補正処理が失敗しても `console.error` のみでユーザーに通知されない。`correctionStatus` が `"failed"` に更新されるが、Cosmos DB patch 自体が失敗した場合は `"processing"` で永久にスタックする。

### DESIGN-4: リトライエンドポイントの並行実行ガード欠如

**場所**: [recordings.ts](../api/src/functions/recordings.ts#L230-L240)  
**問題**: `POST /recordings/{id}/correct` は現在の `correctionStatus` をチェックせずに補正を再実行する。`"processing"` 中に再リトライすると並行して2つの補正が走り、Cosmos DB の race condition が発生し得る。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #70 (保存後AI補正) ──→ BUG-1修正 [セグメント補正対応が必要]
  │
  ├──→ Issue #125 (翻訳AI補正) [同パターンで実装]
  │
  └──→ Issue #126 (リアルタイムAI補正) [二重補正回避が必要]
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| transcriptCorrectionService | Azure OpenAI (gpt-5-mini) | モデル精度・レート制限 | リトライ + フォールバック |
| realtimeCorrection API | Azure OpenAI (gpt-5-mini) | 同上 | 50回/セッション上限あり ✅ |
| 補正結果の表示 | correctedTranscript.segments | **セグメント未補正** 🔴 | BUG-1 修正が必要 |
| correctionStatus ポーリング | Cosmos DB | 3秒間隔の負荷 | WebSocket 移行を将来検討 |

### 5.3 他機能との相互作用

| 機能 | 影響 | 詳細 |
|------|------|------|
| 議事録生成 (summary) | ✅ 影響なし | `correctedTranscript` を優先参照（askAi.ts L53） |
| 話者ラベル (Issue #140) | ⚠️ 軽微 | correctedTranscript.segments に speaker 情報は保持 |
| タイムコード同期 (Issue #135) | ⚠️ 軽微 | correctedTranscript.segments の startTime/endTime は原文のまま保持 |
| Ask AI | ✅ 影響なし | `correctedTranscript || transcript` を参照 |

---

## 6. ブラウザ / 環境互換性リスク

該当なし（本バグはバックエンドロジックとUIロジックの問題）。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0） — BUG-1 修正

**方針C（最小限の変更で即効性あり）**を推奨:

#### 変更ファイル1: `web/src/app/recording/page.tsx`
録音詳細画面で `transcriptView === "corrected"` かつ `correctedTranscript` がある場合、`fullText` をフォールバック表示する。

```tsx
// 現在のセグメント表示ロジックを修正
{displayTranscript?.fullText ? (
  <div ref={transcriptContainerRef} className="max-h-[60vh] overflow-y-auto rounded-md bg-gray-50 p-2 sm:p-4">
    {/* AI補正版は fullText 表示、オリジナルはセグメント表示 */}
    {transcriptView === "corrected" && recording?.correctedTranscript ? (
      <div className="whitespace-pre-wrap text-gray-800 p-2">
        {displayTranscript.fullText}
      </div>
    ) : (
      displayTranscript.segments && displayTranscript.segments.length > 0 ? (
        <div className="space-y-0.5">
          {displayTranscript.segments.map((segment) => { /* ... */ })}
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-gray-800 p-2">
          {displayTranscript.fullText}
        </div>
      )
    )}
  </div>
) : /* ... */}
```

#### 変更ファイル2: `api/src/services/transcriptCorrectionService.ts` （Phase 2 で実施）
将来的にセグメント単位の補正を実装する。

### Phase 2: 設計改善（P1）

#### 2-1: セグメント単位のAI補正（BUG-1 根本解決）
`correctTranscript()` を拡張し、各セグメントも個別に補正する。
- LLM に JSON 形式でセグメントごとの補正結果を要求
- リアルタイム補正 API と同じプロンプトパターンを利用

#### 2-2: 翻訳AI補正の実装（BUG-2: Issue #125）
- `Recording` 型に `correctedTranslations` フィールド追加
- `translateCorrectionService.ts` 新規作成
- `recordingService.ts` で保存時に翻訳補正を fire-and-forget で実行
- 録音詳細の翻訳タブに「オリジナル/AI補正版」切り替えUI追加

#### 2-3: リアルタイム補正のUX改善（BUG-3）
- 録音画面にリアルタイム補正のステータスインジケーター追加
- 設定未有効時に「リアルタイム補正を有効にする」バナー表示
- デフォルト値の見直し（ONにするか、初回起動時のガイド表示）

### Phase 3: 堅牢性強化（P2）

#### 3-1: 二重補正防止（DESIGN-2）
保存ペイロードにリアルタイム補正適用済みフラグを追加:
```typescript
interface CreateRecordingRequest {
  // ...
  isRealtimeCorrected?: boolean;  // リアルタイム補正が適用済みか
}
```

#### 3-2: リトライの並行実行ガード（DESIGN-4）
```typescript
// recordings.ts の correctRecording ハンドラ
const recording = await getRecording(id!, userId);
if (recording?.correctionStatus === "processing") {
  return jsonResponse({ success: false, error: "Correction already in progress" }, 409);
}
```

#### 3-3: correctionStatus スタック防止（DESIGN-3）
`processTranscriptCorrection()` にタイムアウトを追加し、一定時間後に "failed" に更新する。

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|------------|---------|
| 保存後 → correctionStatus = "pending" | ✅ ポーリング開始 |
| correctionStatus "pending" → "processing" → "completed" | ✅ correctedTranscript が表示される |
| correctionStatus "failed" → リトライ → "completed" | ✅ リトライ成功 |
| correctedTranscript のセグメント表示 | **🔴 現在失敗**（BUG-1） |
| enableRealtimeCorrection = false | ✅ リアルタイム補正API未呼出し |
| enableRealtimeCorrection = true + 5セグ蓄積 | ✅ API呼び出し + セグメント更新 |

### 統合テスト

| シナリオ | テスト方法 |
|---------|----------|
| 録音 → 保存 → 詳細画面で補正確認 | E2E テスト |
| 録音中リアルタイム補正 → 保存 → 二重補正なし | モック + E2E |
| 翻訳有効 → 保存 → 翻訳補正表示 | Issue #125 実装後 |

### 手動テスト

| テスト項目 | 確認内容 |
|-----------|---------|
| 録音保存後に詳細画面でAI補正版タブに切り替え | 補正テキストが表示されるか |
| correctionStatus の各状態でのUI表示 | バッジ・スピナー・エラーメッセージ |
| リアルタイム補正設定ON → 録音中 → セグメント更新 | correctedText が反映されるか |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | BUG-1: 詳細画面で corrected 時に fullText 表示（方針C） | 1h | recording/page.tsx |
| 2 | BUG-3: リアルタイム補正の存在をUIで通知 | 2h | page.tsx, settings/page.tsx |
| 3 | DESIGN-4: リトライ並行実行ガード | 1h | recordings.ts |
| 4 | BUG-1根本: セグメント単位AI補正（方針A） | 4h | transcriptCorrectionService.ts |
| 5 | BUG-2: 翻訳AI補正 (Issue #125) | 6h | 新規サービス + UI |
| 6 | DESIGN-2: 二重補正防止 | 2h | recordingService.ts, page.tsx |
| 7 | DESIGN-3: タイムアウト + スタック防止 | 2h | transcriptCorrectionService.ts |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| BUG-1修正方針Cで fullText の改行が失われる | 中 | 低 | CSS `whitespace-pre-wrap` で対応 |
| セグメント単位補正でAPI呼び出しコスト増 | 高 | 中 | バッチ処理 + 単一API呼び出し |
| 翻訳AI補正の翻訳品質がLLMモデルに依存 | 中 | 中 | プロンプトの最適化 + ユーザーレビュー |
| リアルタイム補正デフォルトON でAPIコスト増 | 高 | 高 | 呼び出し上限の設定維持（50回/セッション） |

---

## 11. 結論

### 最大の問題点

**BUG-1（保存後AI補正の表示バグ）** が最も影響が大きい。Azure OpenAI の補正処理自体は正常に動作しており、`correctedTranscript.fullText` は補正されたテキストが保存されている。しかし UI のセグメント表示が `correctedTranscript.segments` を参照し、そこには**原文がそのままコピー**されているため、ユーザーには「補正が動いていない」ように見える。

### API動作確認結果

| API | 状態 | 備考 |
|-----|------|------|
| ヘルスチェック | ✅ 正常 | v1.1.0 |
| リアルタイム補正 (`/correction/realtime`) | ✅ 正常 | 補正結果を正しく返却 |
| 要約生成 (`/summary/generate`) | ✅ 正常 | Azure OpenAI (gpt-5-mini) 動作確認済み |
| 文字起こし補正 (サーバー内部) | ✅ 正常（推定） | 同一 Azure OpenAI 設定を使用 |

### 推奨する修正順序

1. **即座**: BUG-1 の方針C（詳細画面の表示修正）— 1時間で修正可能
2. **短期**: BUG-3 のUX改善（リアルタイム補正のガイダンス表示）
3. **中期**: BUG-1 根本解決（セグメント単位AI補正）
4. **中期**: BUG-2（翻訳AI補正: Issue #125 の実装）
5. **長期**: 堅牢性強化（二重補正防止、タイムアウト等）

### 他 Issue への影響

- Issue #125 (翻訳AI補正): 未実装であることを確認。BUG-1 修正後に着手推奨
- Issue #126 (リアルタイムAI補正): API動作は正常。デフォルトOFF問題のみ
- Issue #103 (補正失敗リトライ): 機能は実装済み。並行実行ガード追加推奨

### 判定: `CONDITIONAL GO`

BUG-1 の方針C（最小限の表示修正）は即座に着手可能。セグメント単位補正（方針A）は設計検討を要する。翻訳AI補正（Issue #125）は別Issue として実装管理。
