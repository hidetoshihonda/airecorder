import { v4 as uuidv4 } from "uuid";
import { getRecordingsContainer } from "./cosmosService";
import {
  uploadAudioBlob,
  deleteAudioBlob,
  generateSasUrl,
} from "./blobService";
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
    transcript: request.transcript,
    translations: request.translations,
    createdAt: now,
    updatedAt: now,
    status: "completed",
  };

  const { resource } = await container.items.create(recording);
  return resource as Recording;
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
  search?: string
): Promise<PaginatedResponse<Recording>> {
  const container = await getRecordingsContainer();

  let queryText = "SELECT * FROM c WHERE c.userId = @userId";
  const parameters: Array<{ name: string; value: string | number }> = [
    { name: "@userId", value: userId },
  ];

  if (search) {
    queryText += " AND CONTAINS(LOWER(c.title), LOWER(@search))";
    parameters.push({ name: "@search", value: search });
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
    createdAt: now,
    updatedAt: now,
    status: "completed",
  };

  const { resource } = await container.items.create(recording);
  const result = resource as Recording;
  result.audioUrl = await generateSasUrl(blobName);

  return result;
}
