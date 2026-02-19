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
    throw new Error(
      "Azure OpenAI is not configured: AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT are required"
    );
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
        translation.segments,
        targetLanguage,
        client,
        deploymentName
      );
    } catch (segErr) {
      // セグメント補正が失敗しても fullText 補正は成功しているので続行
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
  if (segments.length === 0) return segments;

  // segments に id がないものは index ベースで ID を付与
  const segmentsWithIds = segments.map((seg, i) => ({
    ...seg,
    _tempId: seg.id || `tseg-${i}`,
  }));

  const segmentsText = segmentsWithIds
    .map((s) => `[${s._tempId}] ${s.text}`)
    .join("\n");

  const langInstruction = `\n\n重要：出力は ${targetLanguage} で記述してください。`;

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      {
        role: "system",
        content: TRANSLATION_SEGMENT_CORRECTION_PROMPT + langInstruction,
      },
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
    // JSON パースに失敗した場合は元のセグメントを返す
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
    // 録音データを取得
    const { resource: recording } = await container
      .item(recordingId, userId)
      .read<Recording>();

    if (
      !recording?.translations ||
      Object.keys(recording.translations).length === 0
    ) {
      console.log(
        `[TranslationCorrection] No translations for ${recordingId}, skipping`
      );
      return;
    }

    // ステータスを processing に更新
    await container.item(recordingId, userId).patch([
      {
        op: "add",
        path: "/translationCorrectionStatus",
        value: "processing",
      },
      { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
    ]);

    console.log(`[TranslationCorrection] Starting for ${recordingId}`);

    // 全言語の翻訳を順次補正（レート制限対策: Promise.all は使わない）
    const correctedTranslations: { [langCode: string]: Translation } = {};
    for (const [langCode, translation] of Object.entries(
      recording.translations
    )) {
      try {
        correctedTranslations[langCode] = await correctTranslation(
          translation,
          langCode
        );
      } catch (langErr) {
        console.error(
          `[TranslationCorrection] Failed for ${langCode}:`,
          langErr
        );
        // 個別言語の失敗は他の言語に影響させない — 元のテキストを返す
        correctedTranslations[langCode] = translation;
      }
    }

    // 結果を保存
    await container.item(recordingId, userId).patch([
      {
        op: "add",
        path: "/correctedTranslations",
        value: correctedTranslations,
      },
      {
        op: "replace",
        path: "/translationCorrectionStatus",
        value: "completed",
      },
      {
        op: "add",
        path: "/translationCorrectedAt",
        value: new Date().toISOString(),
      },
      { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
    ]);

    console.log(`[TranslationCorrection] Completed for ${recordingId}`);
  } catch (error) {
    console.error(
      `[TranslationCorrection] Failed for ${recordingId}:`,
      error
    );

    // エラー時はステータスを failed に更新
    try {
      await container.item(recordingId, userId).patch([
        {
          op: "replace",
          path: "/translationCorrectionStatus",
          value: "failed",
        },
        {
          op: "add",
          path: "/translationCorrectionError",
          value: (error as Error).message,
        },
        { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
      ]);
    } catch (patchError) {
      console.error(
        `[TranslationCorrection] Failed to update error status:`,
        patchError
      );
    }
  }
}
