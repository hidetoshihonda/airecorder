# AI補正機能不具合 - 実装計画書

**作成日**: 2026-02-19  
**関連分析レビュー**: `docs/Issue_AI補正機能不具合_分析レビュー.md`  
**対象Issue**: #70, #125, #126

---

## Phase 1: BUG-1 修正 — 保存後AI補正版の表示修正（P0）

### 概要

`correctedTranscript.segments` が原文のままコピーされているため、セグメント表示モードで補正結果が見えない問題を修正する。

### Step 1-1: 即時対応（方針C — 表示ロジック修正）

**対象ファイル**: `web/src/app/recording/page.tsx`

**修正内容**: `transcriptView === "corrected"` かつ `correctedTranscript` が存在する場合、セグメント表示ではなく `fullText` をフォールバック表示する。

**変更箇所**: L1099 付近のセグメント表示ロジック

**変更前**:
```tsx
{displayTranscript.segments && displayTranscript.segments.length > 0 ? (
  <div className="space-y-0.5">
    {displayTranscript.segments.map((segment) => {
      // ... セグメント表示（correctedTranscript でも原文表示される）
    })}
  </div>
) : (
  <div className="whitespace-pre-wrap text-gray-800 p-2">
    {displayTranscript.fullText}
  </div>
)}
```

**変更後**:
```tsx
{/* AI補正版は fullText を表示（セグメントは未補正のため） */}
{transcriptView === "corrected" && recording?.correctedTranscript ? (
  <div className="whitespace-pre-wrap text-gray-800 p-2">
    {displayTranscript.fullText}
  </div>
) : displayTranscript.segments && displayTranscript.segments.length > 0 ? (
  <div className="space-y-0.5">
    {displayTranscript.segments.map((segment) => {
      // ... 既存のセグメント表示ロジック
    })}
  </div>
) : (
  <div className="whitespace-pre-wrap text-gray-800 p-2">
    {displayTranscript.fullText}
  </div>
)}
```

**見積り**: 1時間  
**リスク**: 低（表示ロジックの変更のみ）

---

### Step 1-2: 根本修正（方針A — セグメント単位AI補正）

**対象ファイル**: `api/src/services/transcriptCorrectionService.ts`

**修正内容**: `correctTranscript()` を拡張し、各セグメントも LLM で補正する。リアルタイム補正API（`realtimeCorrection.ts`）と同じ JSON 形式のプロンプトを使用。

**変更前**:
```typescript
return {
  segments: transcript.segments,  // 原文のまま
  fullText: correctedText,
};
```

**変更後**:
```typescript
// 1. fullText を補正（既存）
const correctedText = await correctFullText(transcript.fullText, language, client, deploymentName);

// 2. セグメントも個別に補正（新規）
const correctedSegments = await correctSegmentsBatch(
  transcript.segments, language, client, deploymentName
);

return {
  segments: correctedSegments,
  fullText: correctedText,
};
```

**新規関数 `correctSegmentsBatch`**:
```typescript
async function correctSegmentsBatch(
  segments: TranscriptSegment[],
  language: string,
  client: AzureOpenAI,
  deploymentName: string
): Promise<TranscriptSegment[]> {
  // リアルタイム補正と同じプロンプトパターン
  const segmentsText = segments.map(s => `[${s.id}] ${s.text}`).join("\n");
  
  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: SEGMENT_CORRECTION_PROMPT },
      { role: "user", content: segmentsText },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });
  
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  const corrections = new Map(
    (parsed.corrections || []).map((c: any) => [c.id, c.corrected])
  );
  
  return segments.map(seg => ({
    ...seg,
    text: corrections.get(seg.id) || seg.text,
  }));
}
```

**見積り**: 4時間  
**リスク**: 中（LLM の追加呼び出し + コスト増）

---

## Phase 2: BUG-3 修正 — リアルタイム補正のUX改善（P1）

### Step 2-1: 録音画面にリアルタイム補正ステータス表示

**対象ファイル**: `web/src/app/page.tsx`

**修正内容**: 録音中にリアルタイム補正が有効/無効であることを表示。無効の場合は設定画面への誘導リンクを表示。

**見積り**: 2時間

---

## Phase 3: BUG-2 修正 — 翻訳AI補正の実装（P1: Issue #125）

### Step 3-1: Recording 型の拡張

**対象ファイル**: `web/src/types/index.ts`, `api/src/models/recording.ts`

```typescript
// Recording 型に追加
correctedTranslations?: Record<string, Translation>;
translationCorrectionStatus?: "pending" | "processing" | "completed" | "failed";
translationCorrectionError?: string;
```

### Step 3-2: 翻訳補正サービス

**新規ファイル**: `api/src/services/translationCorrectionService.ts`

文字起こし補正と同パターンで翻訳テキストを LLM 補正する。

### Step 3-3: 保存時の翻訳補正トリガー

**対象ファイル**: `api/src/services/recordingService.ts`

`createRecording()` と `saveRecordingWithAudio()` で、翻訳データがある場合に翻訳補正も fire-and-forget で実行。

### Step 3-4: 翻訳タブにオリジナル/AI補正版切り替え追加

**対象ファイル**: `web/src/app/recording/page.tsx`

文字起こしタブと同じパターンで「オリジナル/AI補正版」ボタンを翻訳タブに追加。

**見積り**: 6時間

---

## Phase 4: 堅牢性強化（P2）

### Step 4-1: リトライ並行実行ガード

**対象ファイル**: `api/src/functions/recordings.ts`

```typescript
// correctRecording ハンドラに追加
const recording = await getRecording(id!, userId);
if (recording?.correctionStatus === "processing") {
  return jsonResponse({ success: false, error: "Correction already in progress" }, 409);
}
```

### Step 4-2: 二重補正防止

**対象ファイル**: `api/src/services/recordingService.ts`

保存リクエストにリアルタイム補正適用済みフラグを追加し、サーバー側で考慮する。

### Step 4-3: processTranscriptCorrection タイムアウト

**対象ファイル**: `api/src/services/transcriptCorrectionService.ts`

`AbortController` を使用して、60秒以上かかる場合はタイムアウトさせる。

**見積り**: 各1-2時間

---

## 実装順序サマリー

| 順番 | 内容 | 見積り | 優先度 |
|------|------|--------|--------|
| 1 | Step 1-1: 表示ロジック修正（即時対応） | 1h | P0 |
| 2 | Step 4-1: リトライ並行実行ガード | 1h | P2 |
| 3 | Step 2-1: リアルタイム補正UX改善 | 2h | P1 |
| 4 | Step 1-2: セグメント単位AI補正 | 4h | P1 |
| 5 | Step 3-1〜3-4: 翻訳AI補正 (Issue #125) | 6h | P1 |
| 6 | Step 4-2〜4-3: 堅牢性強化 | 3h | P2 |

**合計見積り**: 約 17時間
