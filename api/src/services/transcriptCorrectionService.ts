/**
 * LLM による文字起こし補正サービス (Issue #70)
 * セグメント単位 + fullText の両方を補正する
 */
import { AzureOpenAI } from "openai";
import { Transcript, TranscriptSegment, Recording } from "../models";
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

const SEGMENT_CORRECTION_PROMPT = `あなたは音声認識結果をリアルタイムで校正する専門家です。
与えられた複数の発言セグメントを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」、「以上」→「異常」）
- 明らかな聞き間違い
- 不自然な単語の区切り
- 固有名詞の誤認識（文脈から推測可能な場合）

【修正してはいけないもの】
- 話者の意図や内容を変える
- 文体や口調（話し言葉のまま）
- 文法的に正しい表現への書き換え
- 修正不要なセグメント

JSON形式で出力:
{
  "corrections": [
    { "id": "セグメントID", "original": "原文", "corrected": "補正後テキスト" }
  ]
}

修正が不要な場合は "corrections": [] を返してください。
修正があるセグメントのみ出力してください。`;

interface CorrectionItem {
  id: string;
  original: string;
  corrected: string;
}

/**
 * セグメント単位でバッチ補正を実行
 * リアルタイム補正 API (realtimeCorrection.ts) と同じプロンプトパターンを使用
 */
async function correctSegmentsBatch(
  segments: TranscriptSegment[],
  language: string | undefined,
  client: AzureOpenAI,
  deploymentName: string
): Promise<TranscriptSegment[]> {
  if (segments.length === 0) return segments;

  // セグメントに id がないものは index ベースで ID を付与
  const segmentsWithIds = segments.map((seg, i) => ({
    ...seg,
    _tempId: seg.id || `seg-${i}`,
  }));

  const segmentsText = segmentsWithIds
    .map((s) => `[${s._tempId}] ${s.text}`)
    .join("\n");

  const langInstruction = language && !language.startsWith("ja")
    ? "\n\n重要：出力は元のテキストと同じ言語で記述してください。"
    : "";

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: SEGMENT_CORRECTION_PROMPT + langInstruction },
      {
        role: "user",
        content: `以下の発言セグメントを確認してください:\n\n${segmentsText}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return segments;

  try {
    const parsed = JSON.parse(content) as { corrections?: CorrectionItem[] };
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
 * Azure OpenAI を使用してトランスクリプトを補正
 * セグメント単位 + fullText の両方を補正する
 */
export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
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

  // 1. fullText を補正（既存ロジック）
  const fullTextResponse = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      { role: "system", content: CORRECTION_PROMPT },
      { role: "user", content: `【言語: ${language || "ja-JP"}】\n\n${transcript.fullText}` },
    ],
    temperature: 0.3,
  });

  const correctedText = fullTextResponse.choices[0]?.message?.content?.trim();
  if (!correctedText) {
    throw new Error("No response from OpenAI");
  }

  // 2. セグメント単位でも補正（新規: セグメントが存在する場合のみ）
  let correctedSegments = transcript.segments;
  if (transcript.segments && transcript.segments.length > 0) {
    try {
      correctedSegments = await correctSegmentsBatch(
        transcript.segments, language, client, deploymentName
      );
    } catch (segErr) {
      // セグメント補正が失敗しても fullText 補正は成功しているので続行
      console.error("[Correction] Segment correction failed, using originals:", segErr);
    }
  }

  return {
    segments: correctedSegments,
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
