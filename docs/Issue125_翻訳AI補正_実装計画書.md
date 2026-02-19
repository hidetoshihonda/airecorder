# Issue #125: 翻訳テキストの保存後AI補正機能 — 実装計画書

**作成日**: 2026-02-19  
**対象Issue**: [#125 feat: 翻訳テキストの保存後AI補正機能](https://github.com/hidetoshihonda/airecorder/issues/125)  
**前提ドキュメント**: [Issue125_翻訳AI補正_分析レビュー.md](Issue125_翻訳AI補正_分析レビュー.md)  
**判定**: GO  

---

## 実装概要

文字起こし補正（Issue #70, PR #163）の設計パターンを翻訳テキストに横展開する。  
保存後にLLMで翻訳品質を向上させ、オリジナル/AI補正版を切り替え表示可能にする。

---

## Step 1: データモデル拡張

### 1.1 API モデル (`api/src/models/recording.ts`)

`Recording` インターフェースに以下のフィールドを追加（`speakerLabels` の後に挿入）:

```typescript
  // 翻訳AI補正 (Issue #125)
  correctedTranslations?: { [languageCode: string]: Translation };
  translationCorrectionStatus?: "pending" | "processing" | "completed" | "failed";
  translationCorrectionError?: string;
  translationCorrectedAt?: string;
```

### 1.2 Frontend 型 (`web/src/types/index.ts`)

`Recording` インターフェースに以下のフィールドを追加（`correctedAt` の後に挿入）:

```typescript
  // 翻訳AI補正 (Issue #125)
  correctedTranslations?: Record<string, Translation>;
  translationCorrectionStatus?: "pending" | "processing" | "completed" | "failed";
  translationCorrectionError?: string;
  translationCorrectedAt?: string;
```

---

## Step 2: 翻訳補正サービス作成

### 2.1 新規ファイル: `api/src/services/translationCorrectionService.ts`

`transcriptCorrectionService.ts` のパターンを横展開。

```typescript
/**
 * LLM による翻訳テキスト補正サービス (Issue #125)
 * 保存後の翻訳テキストを LLM で品質向上させる
 */
import { AzureOpenAI } from "openai";
import { Translation, Recording } from "../models";
import { getRecordingsContainer } from "./cosmosService";

const TRANSLATION_CORRECTION_PROMPT = `あなたは機械翻訳のテキストを校正する専門家です。
以下の機械翻訳テキストを確認し、不自然な表現のみを修正してください。

【修正すべきもの】
- 不自然な直訳表現（自然な表現に改善）
- ぎこちない語順や文構造
- 文脈に合わない単語選択
- 明らかな翻訳エラー

【修正してはいけないもの】
- 原文の意味や情報を変える
- 専門用語の翻訳（文脈が不明な場合）
- 翻訳スタイルの大幅な変更
- 話者の意図を変えるような書き換え

修正後のテキスト全文のみを返してください。説明は不要です。`;

const TRANSLATION_SEGMENT_CORRECTION_PROMPT = `あなたは機械翻訳のテキストを校正する専門家です。
与えられた複数の翻訳セグメントを確認し、不自然な表現のみを修正してください。

【修正すべきもの】
- 不自然な直訳表現
- ぎこちない語順
- 文脈に合わない単語選択
- 明らかな翻訳エラー

【修正してはいけないもの】
- 原文の意味や情報を変える
- 専門用語の翻訳
- 修正不要なセグメント

JSON形式で出力:
{
  "corrections": [
    { "id": "セグメントID", "original": "原文", "corrected": "補正後テキスト" }
  ]
}

修正が不要な場合は "corrections": [] を返してください。
修正があるセグメントのみ出力してください。`;

/**
 * 翻訳テキストを LLM で補正
 */
export async function correctTranslation(
  translation: Translation,
  targetLanguage: string
): Promise<Translation> {
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

  if (!apiKey || !endpoint) {
    throw new Error("Azure OpenAI is not configured");
  }

  const client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: "2024-08-01-preview",
  });

  // 1. fullText を補正
  const fullTextResponse = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: TRANSLATION_CORRECTION_PROMPT },
      {
        role: "user",
        content: `【翻訳先言語: ${targetLanguage}】\n\n${translation.fullText}`,
      },
    ],
    temperature: 0.3,
  });

  const correctedText = fullTextResponse.choices[0]?.message?.content?.trim();
  if (!correctedText) {
    throw new Error("No response from OpenAI for translation correction");
  }

  // 2. セグメント単位でも補正（セグメントが存在する場合）
  let correctedSegments = translation.segments;
  if (translation.segments && translation.segments.length > 0) {
    try {
      correctedSegments = await correctTranslationSegments(
        translation.segments, targetLanguage, client, deploymentName
      );
    } catch (segErr) {
      console.error("[TranslationCorrection] Segment correction failed:", segErr);
    }
  }

  return {
    language: translation.language,
    segments: correctedSegments,
    fullText: correctedText,
  };
}

/**
 * セグメント単位の翻訳補正
 */
async function correctTranslationSegments(
  segments: Translation["segments"],
  targetLanguage: string,
  client: AzureOpenAI,
  deploymentName: string
): Promise<Translation["segments"]> {
  // segments にはIDがない場合があるので index ベースで ID 付与
  const segmentsWithIds = segments.map((seg, i) => ({
    ...seg,
    _tempId: (seg as any).id || `tseg-${i}`,
  }));

  const segmentsText = segmentsWithIds
    .map((s) => `[${s._tempId}] ${s.text}`)
    .join("\n");

  const langInstruction = `\n\n重要：出力は ${targetLanguage} で記述してください。`;

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: TRANSLATION_SEGMENT_CORRECTION_PROMPT + langInstruction },
      {
        role: "user",
        content: `以下の翻訳セグメントを確認してください:\n\n${segmentsText}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return segments;

  try {
    const parsed = JSON.parse(content) as {
      corrections?: Array<{ id: string; corrected: string }>;
    };
    const corrections = new Map(
      (parsed.corrections || []).map((c) => [c.id, c.corrected])
    );

    return segmentsWithIds.map((seg) => {
      const corrected = corrections.get(seg._tempId);
      const { _tempId, ...original } = seg;
      return corrected ? { ...original, text: corrected } : original;
    });
  } catch {
    return segments;
  }
}

/**
 * 録音の翻訳補正処理を非同期で実行
 */
export async function processTranslationCorrection(
  recordingId: string,
  userId: string
): Promise<void> {
  const container = await getRecordingsContainer();

  try {
    const { resource: recording } = await container
      .item(recordingId, userId)
      .read<Recording>();

    if (!recording?.translations || Object.keys(recording.translations).length === 0) {
      console.log(`[TranslationCorrection] No translations for ${recordingId}, skipping`);
      return;
    }

    // ステータスを processing に更新
    await container.item(recordingId, userId).patch([
      { op: "add", path: "/translationCorrectionStatus", value: "processing" },
      { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
    ]);

    console.log(`[TranslationCorrection] Starting for ${recordingId}`);

    // 全言語の翻訳を順次補正
    const correctedTranslations: { [langCode: string]: Translation } = {};
    for (const [langCode, translation] of Object.entries(recording.translations)) {
      try {
        correctedTranslations[langCode] = await correctTranslation(
          translation,
          langCode
        );
      } catch (langErr) {
        console.error(`[TranslationCorrection] Failed for ${langCode}:`, langErr);
        // 個別言語の失敗は他の言語に影響させない
        correctedTranslations[langCode] = translation;
      }
    }

    // 結果を保存
    await container.item(recordingId, userId).patch([
      { op: "add", path: "/correctedTranslations", value: correctedTranslations },
      { op: "replace", path: "/translationCorrectionStatus", value: "completed" },
      { op: "add", path: "/translationCorrectedAt", value: new Date().toISOString() },
      { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
    ]);

    console.log(`[TranslationCorrection] Completed for ${recordingId}`);
  } catch (error) {
    console.error(`[TranslationCorrection] Failed for ${recordingId}:`, error);

    try {
      await container.item(recordingId, userId).patch([
        { op: "replace", path: "/translationCorrectionStatus", value: "failed" },
        { op: "add", path: "/translationCorrectionError", value: (error as Error).message },
        { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
      ]);
    } catch (patchError) {
      console.error(`[TranslationCorrection] Failed to update error status:`, patchError);
    }
  }
}
```

### 2.2 エクスポート追加: `api/src/services/index.ts`

```typescript
export { processTranslationCorrection } from "./translationCorrectionService";
```

---

## Step 3: 保存時の自動キック

### 3.1 `api/src/services/recordingService.ts`

`createRecording()` 関数の補正キック部分を修正:

**変更前**:
```typescript
if (request.transcript?.fullText) {
  processTranscriptCorrection(result.id, result.userId).catch((err) => {
    console.error(`[Correction] Failed to start for ${result.id}:`, err);
  });
}
```

**変更後**:
```typescript
if (request.transcript?.fullText) {
  processTranscriptCorrection(result.id, result.userId)
    .then(() => {
      // transcript 補正完了後に翻訳補正を開始（レート制限対策: 順次実行）
      if (request.translations && Object.keys(request.translations).length > 0) {
        return processTranslationCorrection(result.id, result.userId);
      }
    })
    .catch((err) => {
      console.error(`[Correction] Failed for ${result.id}:`, err);
    });
} else if (request.translations && Object.keys(request.translations).length > 0) {
  // transcript がなくても翻訳がある場合は翻訳補正のみ実行
  processTranslationCorrection(result.id, result.userId).catch((err) => {
    console.error(`[TranslationCorrection] Failed to start for ${result.id}:`, err);
  });
}
```

`saveRecordingWithAudio()` にも同じ変更を適用。

### 3.2 `api/src/services/recordingService.ts` のモデルに translationCorrectionStatus 初期値追加

`createRecording()` と `saveRecordingWithAudio()` の Recording オブジェクト生成部分:

```typescript
const recording: Recording = {
  // ... 既存フィールド
  correctionStatus: request.transcript?.fullText ? "pending" : undefined,
  // Issue #125: 翻訳補正ステータス
  translationCorrectionStatus: (request.translations && Object.keys(request.translations).length > 0)
    ? "pending" : undefined,
  // ...
};
```

---

## Step 4: 手動リトライ API エンドポイント

### 4.1 `api/src/functions/recordings.ts`

既存の `correctRecording` エンドポイントの後に追加:

```typescript
// POST /api/recordings/{id}/correct-translation - 翻訳補正を手動で再実行 (Issue #125)
app.http("correctTranslation", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{id}/correct-translation",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;
    const userId = request.query.get("userId");

    if (!userId) {
      return jsonResponse(
        { success: false, error: "userId is required" },
        400
      );
    }

    try {
      const recording = await getRecording(id!, userId);
      if (!recording) {
        return jsonResponse(
          { success: false, error: "Recording not found" },
          404
        );
      }

      if (recording.translationCorrectionStatus === "processing") {
        return jsonResponse(
          { success: false, error: "Translation correction already in progress" },
          409
        );
      }

      if (!recording.translations || Object.keys(recording.translations).length === 0) {
        return jsonResponse(
          { success: false, error: "No translations to correct" },
          400
        );
      }

      processTranslationCorrection(id!, userId).catch((err) => {
        console.error(`[TranslationCorrection] Manual correction failed for ${id}:`, err);
      });

      return jsonResponse({
        success: true,
        data: { message: "Translation correction started" },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

---

## Step 5: Frontend API サービス

### 5.1 `web/src/services/recordingsApi.ts`

`retryCorrection()` の後に追加:

```typescript
  /**
   * 翻訳補正を手動で再実行 (Issue #125)
   */
  async retryTranslationCorrection(id: string): Promise<ApiResponse<{ message: string }>> {
    const authError = this.requireAuth<{ message: string }>();
    if (authError) return authError;

    const params = new URLSearchParams({ userId: this.userId! });
    return this.request<{ message: string }>(
      `/recordings/${id}/correct-translation?${params.toString()}`,
      { method: "POST" }
    );
  }
```

---

## Step 6: フロントエンド UI

### 6.1 `web/src/app/recording/page.tsx`

#### 6.1.1 State 追加

既存の `transcriptView` の近くに追加:

```typescript
const [translationView, setTranslationView] = useState<"original" | "corrected">("corrected");
```

#### 6.1.2 displayTranslations memo 追加

```typescript
const displayTranslations = useMemo(() => {
  if (translationView === "corrected" && recording?.correctedTranslations) {
    return recording.correctedTranslations;
  }
  return recording?.translations;
}, [recording, translationView]);
```

#### 6.1.3 翻訳補正ステータスバッジ

```typescript
const translationCorrectionStatusBadge = useMemo(() => {
  switch (recording?.translationCorrectionStatus) {
    case "pending":
    case "processing":
      return <span className="text-xs text-blue-500 animate-pulse">{t("translationCorrectionPending")}</span>;
    case "completed":
      return <span className="text-xs text-green-600">{t("translationCorrectionCompleted")}</span>;
    case "failed":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs text-red-500">{t("translationCorrectionFailed")}</span>
          <Button
            variant="ghost" size="sm"
            onClick={handleRetryTranslationCorrection}
            disabled={isRetryingTranslationCorrection}
            className="text-xs h-6 px-2"
          >
            {t("retryTranslationCorrection")}
          </Button>
        </div>
      );
    default:
      return null;
  }
}, [recording?.translationCorrectionStatus, isRetryingTranslationCorrection, t]);
```

#### 6.1.4 リトライハンドラー

```typescript
const [isRetryingTranslationCorrection, setIsRetryingTranslationCorrection] = useState(false);

const handleRetryTranslationCorrection = async () => {
  if (!id || isRetryingTranslationCorrection) return;
  setIsRetryingTranslationCorrection(true);
  try {
    const response = await recordingsApi.retryTranslationCorrection(id);
    if (!response.error) {
      setRecording((prev) =>
        prev ? { ...prev, translationCorrectionStatus: "pending", translationCorrectionError: undefined } : prev
      );
    }
  } catch (err) {
    console.error("[TranslationCorrection] Retry failed:", err);
  } finally {
    setIsRetryingTranslationCorrection(false);
  }
};
```

#### 6.1.5 翻訳タブ UI の修正

翻訳タブ (`<TabsContent value="translation">`) を以下のように修正:

```tsx
<TabsContent value="translation">
  <Card>
    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 sm:gap-4">
        <CardTitle className="text-lg">{t("translation")}</CardTitle>
        {translationCorrectionStatusBadge}
      </div>
      <div className="flex items-center gap-2">
        {/* オリジナル / AI補正版 切り替え (Issue #125) */}
        {recording.correctedTranslations && (
          <div className="flex w-full rounded-lg border p-1 sm:w-auto">
            <Button
              variant={translationView === "original" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTranslationView("original")}
              className="flex-1 text-xs sm:flex-none"
            >
              {t("original")}
            </Button>
            <Button
              variant={translationView === "corrected" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTranslationView("corrected")}
              className="flex-1 gap-1 text-xs sm:flex-none"
            >
              <Sparkles className="h-3 w-3" />
              {t("aiCorrected")}
            </Button>
          </div>
        )}
      </div>
    </CardHeader>
    <CardContent>
      {displayTranslations && Object.keys(displayTranslations).length > 0 ? (
        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {Object.entries(displayTranslations).map(([langCode, translation]) => {
            const lang = SUPPORTED_LANGUAGES.find(
              (l) => l.code === langCode || l.translatorCode === langCode
            );
            return (
              <div key={langCode}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-500">
                    {lang?.flag} {lang?.name || langCode}
                  </p>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => handleCopy(translation.fullText, langCode)}
                    className="gap-2"
                  >
                    {copied === langCode ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {t("copy")}
                  </Button>
                </div>
                <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
                  {translation.fullText}
                </div>
              </div>
            );
          })}
        </div>
      ) : recording.translationCorrectionStatus === "pending" ||
        recording.translationCorrectionStatus === "processing" ? (
        <div className="py-8 text-center text-blue-500 animate-pulse">
          {t("translationCorrectionPending")}
        </div>
      ) : (
        <div className="py-8 text-center text-gray-500">
          {t("noTranslation")}
        </div>
      )}
    </CardContent>
  </Card>
</TabsContent>
```

#### 6.1.6 ポーリング拡張

既存の correctionStatus ポーリング useEffect を拡張して、translationCorrectionStatus も監視:

```typescript
// 既存ポーリングの条件に追加
useEffect(() => {
  if (
    (recording?.correctionStatus !== "pending" && recording?.correctionStatus !== "processing") &&
    (recording?.translationCorrectionStatus !== "pending" && recording?.translationCorrectionStatus !== "processing")
  ) {
    return;
  }

  const interval = setInterval(async () => {
    // 既存のポーリングロジック
    // ...
    // translationCorrectionStatus も completed/failed でポーリング停止判定
  }, 3000);

  return () => clearInterval(interval);
}, [id, recording?.correctionStatus, recording?.translationCorrectionStatus]);
```

---

## Step 7: i18n メッセージ追加

### 7.1 `web/messages/ja.json` — RecordingDetail セクション

```json
"translationCorrectionPending": "⏳ 翻訳AI補正中...",
"translationCorrectionCompleted": "✨ 翻訳AI補正済み",
"translationCorrectionFailed": "❌ 翻訳補正失敗",
"retryTranslationCorrection": "再試行"
```

### 7.2 `web/messages/en.json` — RecordingDetail セクション

```json
"translationCorrectionPending": "⏳ AI correcting translation...",
"translationCorrectionCompleted": "✨ AI corrected",
"translationCorrectionFailed": "❌ Translation correction failed",
"retryTranslationCorrection": "Retry"
```

### 7.3 `web/messages/es.json` — RecordingDetail セクション

```json
"translationCorrectionPending": "⏳ Corrigiendo traducción con IA...",
"translationCorrectionCompleted": "✨ Traducción corregida por IA",
"translationCorrectionFailed": "❌ Corrección de traducción fallida",
"retryTranslationCorrection": "Reintentar"
```

---

## 注意事項

### レート制限対策

- transcript 補正と翻訳補正は **順次実行** する（fire-and-forget の中で `.then()` チェーン）
- 複数言語がある場合も `for...of` で順次処理（`Promise.all` は使わない）

### 後方互換性

- 新フィールド (`correctedTranslations` 等) は全て optional
- 既存の録音データに影響なし
- `correctedTranslations` が `undefined` の場合はオリジナル表示

### Cosmos DB

- スキーマレスのため、新フィールド追加にマイグレーション不要
- `patch` 操作で `add` を使用（フィールドが存在しなくても安全）

---

## 変更ファイル一覧

| # | ファイル | 変更種別 | 概要 |
|---|---------|---------|------|
| 1 | `api/src/models/recording.ts` | 変更 | correctedTranslations 等 4フィールド追加 |
| 2 | `api/src/services/translationCorrectionService.ts` | **新規** | 翻訳補正サービス |
| 3 | `api/src/services/index.ts` | 変更 | エクスポート追加 |
| 4 | `api/src/services/recordingService.ts` | 変更 | 翻訳補正キック追加 |
| 5 | `api/src/functions/recordings.ts` | 変更 | 翻訳リトライ API 追加 |
| 6 | `web/src/types/index.ts` | 変更 | correctedTranslations 等 4フィールド追加 |
| 7 | `web/src/services/recordingsApi.ts` | 変更 | retryTranslationCorrection() 追加 |
| 8 | `web/src/app/recording/page.tsx` | 変更 | 翻訳タブ切り替え UI 追加 |
| 9 | `web/messages/ja.json` | 変更 | 翻訳補正メッセージ 4件追加 |
| 10 | `web/messages/en.json` | 変更 | 翻訳補正メッセージ 4件追加 |
| 11 | `web/messages/es.json` | 変更 | 翻訳補正メッセージ 4件追加 |

**見積り**: 約3時間  
**リスク**: 低（既存パターンの横展開）
