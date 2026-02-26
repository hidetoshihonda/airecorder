import { v4 as uuidv4 } from "uuid";
import { getRecordingsContainer } from "./cosmosService";
import {
  uploadAudioBlob,
  deleteAudioBlob,
  generateSasUrl,
} from "./blobService";
import { processTranscriptCorrection } from "./transcriptCorrectionService";
import { processTranslationCorrection } from "./translationCorrectionService";
import {
  Recording,
  CreateRecordingRequest,
  UpdateRecordingRequest,
  PaginatedResponse,
} from "../models";

export async function createRecording(
  request: CreateRecordingRequest
): Promise<Recording> {
  const container = await getRecordingsContainer();

  const now = new Date().toISOString();
  const recording: Recording = {
    id: uuidv4(),
    userId: request.userId,
    title: request.title,
    sourceLanguage: request.sourceLanguage,
    duration: request.duration,
    audioUrl: request.audioUrl,
    transcript: request.transcript,
    translations: request.translations,
    // LLM 補正ステータス (Issue #70)
    correctionStatus: request.transcript?.fullText ? "pending" : undefined,
    // 翻訳AI補正ステータス (Issue #125)
    translationCorrectionStatus: (request.translations && Object.keys(request.translations).length > 0)
      ? "pending" : undefined,
    createdAt: now,
    updatedAt: now,
    status: "completed",
  };

  const { resource } = await container.items.create(recording);
  const result = resource as Recording;

  // 非同期で補正処理をキック (Issue #70 + Issue #125)
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

  return result;
}

export async function getRecording(
  id: string,
  userId: string
): Promise<Recording | null> {
  const container = await getRecordingsContainer();

  try {
    const { resource } = await container.item(id, userId).read<Recording>();
    if (resource && resource.audioBlobName) {
      resource.audioUrl = await generateSasUrl(resource.audioBlobName);
    }
    return resource || null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateRecording(
  id: string,
  userId: string,
  updates: UpdateRecordingRequest
): Promise<Recording | null> {
  const container = await getRecordingsContainer();

  const existing = await getRecording(id, userId);
  if (!existing) {
    return null;
  }

  const updated: Recording = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const { resource } = await container.item(id, userId).replace(updated);
  return resource as Recording;
}

export async function deleteRecording(
  id: string,
  userId: string
): Promise<boolean> {
  const container = await getRecordingsContainer();

  const existing = await getRecording(id, userId);
  if (!existing) {
    return false;
  }

  // Delete audio blob if exists
  if (existing.audioBlobName) {
    await deleteAudioBlob(existing.audioBlobName);
  }

  await container.item(id, userId).delete();
  return true;
}

export async function listRecordings(
  userId: string,
  page: number = 1,
  limit: number = 20,
  search?: string,
  folderId?: string,
  tag?: string
): Promise<PaginatedResponse<Recording>> {
  const container = await getRecordingsContainer();

  let queryText = "SELECT * FROM c WHERE c.userId = @userId";
  const parameters: Array<{ name: string; value: string | number }> = [
    { name: "@userId", value: userId },
  ];

  if (search) {
    queryText +=
      " AND (" +
      "CONTAINS(LOWER(c.title), LOWER(@search))" +
      " OR (IS_DEFINED(c.transcript.fullText) AND CONTAINS(LOWER(c.transcript.fullText), LOWER(@search)))" +
      " OR (IS_DEFINED(c.correctedTranscript.fullText) AND CONTAINS(LOWER(c.correctedTranscript.fullText), LOWER(@search)))" +
      ")";
    parameters.push({ name: "@search", value: search });
  }

  if (folderId) {
    queryText += " AND c.folderId = @folderId";
    parameters.push({ name: "@folderId", value: folderId });
  }

  // Issue #80: タグフィルタ
  if (tag) {
    queryText += " AND ARRAY_CONTAINS(c.tags, @tag)";
    parameters.push({ name: "@tag", value: tag });
  }

  queryText += " ORDER BY c.createdAt DESC";

  // Get total count
  const countQuery = queryText.replace("SELECT *", "SELECT VALUE COUNT(1)");
  const { resources: countResult } = await container.items
    .query({
      query: countQuery,
      parameters,
    })
    .fetchAll();
  const total = countResult[0] || 0;

  // Get paginated results
  const offset = (page - 1) * limit;
  queryText += ` OFFSET ${offset} LIMIT ${limit}`;

  const { resources } = await container.items
    .query<Recording>({
      query: queryText,
      parameters,
    })
    .fetchAll();

  return {
    items: resources,
    total,
    page,
    limit,
    hasMore: offset + resources.length < total,
  };
}

export async function saveRecordingWithAudio(
  request: CreateRecordingRequest,
  audioData: Buffer
): Promise<Recording> {
  const container = await getRecordingsContainer();

  const now = new Date().toISOString();
  const recordingId = uuidv4();

  // Upload audio to blob storage
  const blobName = await uploadAudioBlob(
    request.userId,
    recordingId,
    audioData
  );

  const recording: Recording = {
    id: recordingId,
    userId: request.userId,
    title: request.title,
    sourceLanguage: request.sourceLanguage,
    duration: request.duration,
    transcript: request.transcript,
    translations: request.translations,
    audioBlobName: blobName,
    // LLM 補正ステータス (Issue #70)
    correctionStatus: request.transcript?.fullText ? "pending" : undefined,
    // 翻訳AI補正ステータス (Issue #125)
    translationCorrectionStatus: (request.translations && Object.keys(request.translations).length > 0)
      ? "pending" : undefined,
    createdAt: now,
    updatedAt: now,
    status: "completed",
  };

  const { resource } = await container.items.create(recording);
  const result = resource as Recording;
  result.audioUrl = await generateSasUrl(blobName);

  // 非同期で補正処理をキック (Issue #70 + Issue #125)
  if (request.transcript?.fullText) {
    processTranscriptCorrection(result.id, result.userId)
      .then(() => {
        if (request.translations && Object.keys(request.translations).length > 0) {
          return processTranslationCorrection(result.id, result.userId);
        }
      })
      .catch((err) => {
        console.error(`[Correction] Failed for ${result.id}:`, err);
      });
  } else if (request.translations && Object.keys(request.translations).length > 0) {
    processTranslationCorrection(result.id, result.userId).catch((err) => {
      console.error(`[TranslationCorrection] Failed to start for ${result.id}:`, err);
    });
  }

  return result;
}

/**
 * ユーザーが使用している全タグの一覧を取得 (Issue #171)
 */
export async function getUserTags(userId: string): Promise<string[]> {
  const container = await getRecordingsContainer();

  const { resources } = await container.items
    .query<string>({
      query:
        "SELECT DISTINCT VALUE tag FROM c JOIN tag IN c.tags WHERE c.userId = @userId",
      parameters: [{ name: "@userId", value: userId }],
    })
    .fetchAll();

  return resources.sort();
}

/**
 * 複数録音を一括取得 (Issue #90: クロスミーティング集計分析)
 * Cosmos DB の IN クエリでバッチ取得（最大20件）
 */
export async function getMultipleRecordings(
  ids: string[],
  userId: string
): Promise<Recording[]> {
  if (ids.length === 0) return [];
  if (ids.length > 20) {
    throw new Error("Maximum 20 recordings can be selected for cross-analysis");
  }

  const container = await getRecordingsContainer();

  // IN クエリ用のパラメータを動的に構築
  const placeholders = ids.map((_, i) => `@id${i}`).join(", ");
  const parameters: Array<{ name: string; value: string }> = [
    { name: "@userId", value: userId },
    ...ids.map((id, i) => ({ name: `@id${i}`, value: id })),
  ];

  const { resources } = await container.items
    .query<Recording>({
      query: `SELECT * FROM c WHERE c.userId = @userId AND c.id IN (${placeholders}) ORDER BY c.createdAt ASC`,
      parameters,
    })
    .fetchAll();

  return resources;
}
