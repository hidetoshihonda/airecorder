/**
 * LLM による文字起こし補正サービス (Issue #70)
 */
import { AzureOpenAI } from "openai";
import { Transcript, Recording } from "../models";
import { getRecordingsContainer } from "./cosmosService";

const CORRECTION_PROMPT = `あなたは音声認識結果を校正する専門家です。
以下の文字起こしテキストを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」、「以上」→「異常」）
- 明らかな聞き間違い
- 不自然な単語の区切り
- 固有名詞の誤認識（文脈から推測可能な場合）

【修正してはいけないもの】
- 話者の意図や内容
- 文体や口調（話し言葉のまま）
- 文法的に正しい表現への過度な書き換え
- 句読点の大幅な変更

修正後のテキスト全文のみを返してください。説明は不要です。`;

/**
 * Azure OpenAI を使用してトランスクリプトを補正
 */
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2024-02-15-preview",
  });

  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: CORRECTION_PROMPT },
      { role: "user", content: `【言語: ${language || "ja-JP"}】\n\n${transcript.fullText}` },
    ],
    temperature: 0.3,
  });

  const correctedText = response.choices[0]?.message?.content?.trim();
  if (!correctedText) {
    throw new Error("No response from OpenAI");
  }

  // セグメントは元のまま、fullText のみ補正版に置き換え
  return {
    segments: transcript.segments,
    fullText: correctedText,
  };
}

/**
 * 録音の補正処理を非同期で実行
 */
export async function processTranscriptCorrection(
  recordingId: string,
  userId: string
): Promise<void> {
  const container = await getRecordingsContainer();

  try {
    // 録音データを取得
    const { resource: recording } = await container
      .item(recordingId, userId)
      .read<Recording>();

    if (!recording?.transcript?.fullText) {
      console.log(`[Correction] No transcript for ${recordingId}, skipping`);
      return;
    }

    // ステータスを processing に更新
    await container.item(recordingId, userId).patch([
      { op: "replace", path: "/correctionStatus", value: "processing" },
      { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
    ]);

    console.log(`[Correction] Starting correction for ${recordingId}`);

    // LLM で補正
    const correctedTranscript = await correctTranscript(
      recording.transcript,
      recording.sourceLanguage
    );

    // 結果を保存
    await container.item(recordingId, userId).patch([
      { op: "add", path: "/correctedTranscript", value: correctedTranscript },
      { op: "replace", path: "/correctionStatus", value: "completed" },
      { op: "add", path: "/correctedAt", value: new Date().toISOString() },
      { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
    ]);

    console.log(`[Correction] Completed for ${recordingId}`);
  } catch (error) {
    console.error(`[Correction] Failed for ${recordingId}:`, error);

    // エラー時はステータスを failed に更新
    try {
      await container.item(recordingId, userId).patch([
        { op: "replace", path: "/correctionStatus", value: "failed" },
        { op: "add", path: "/correctionError", value: (error as Error).message },
        { op: "replace", path: "/updatedAt", value: new Date().toISOString() },
      ]);
    } catch (patchError) {
      console.error(`[Correction] Failed to update error status:`, patchError);
    }
  }
}
