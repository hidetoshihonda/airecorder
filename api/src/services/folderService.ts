import { v4 as uuidv4 } from "uuid";
import { getFoldersContainer, getRecordingsContainer } from "./cosmosService";
import {
  FolderDocument,
  Folder,
  CreateFolderRequest,
  UpdateFolderRequest,
} from "../models";

// Convert Cosmos document to API response format
function toFolder(doc: FolderDocument): Folder {
  return {
    id: doc.id,
    name: doc.name,
    color: doc.color,
    sortOrder: doc.sortOrder,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * List all folders for a user
 */
export async function listFolders(userId: string): Promise<Folder[]> {
  const container = await getFoldersContainer();
  const { resources } = await container.items
    .query<FolderDocument>({
      query:
        "SELECT * FROM c WHERE c.userId = @userId AND c.type = @type ORDER BY c.sortOrder ASC",
      parameters: [
        { name: "@userId", value: userId },
        { name: "@type", value: "folder" },
      ],
    })
    .fetchAll();
  return resources.map(toFolder);
}

/**
 * Create a new folder
 */
export async function createFolder(
  request: CreateFolderRequest
): Promise<Folder> {
  const container = await getFoldersContainer();
  const now = new Date().toISOString();

  // Get current max sortOrder
  const existing = await listFolders(request.userId);
  const maxSortOrder =
    existing.length > 0 ? Math.max(...existing.map((f) => f.sortOrder)) : 0;

  const doc: FolderDocument = {
    id: uuidv4(),
    userId: request.userId,
    name: request.name,
    color: request.color,
    sortOrder: maxSortOrder + 1,
    createdAt: now,
    updatedAt: now,
    type: "folder",
  };

  const { resource } = await container.items.create(doc);
  return toFolder(resource as FolderDocument);
}

/**
 * Get a single folder by ID
 */
export async function getFolder(
  id: string,
  userId: string
): Promise<Folder | null> {
  const container = await getFoldersContainer();
  try {
    const { resource } = await container
      .item(id, userId)
      .read<FolderDocument>();
    return resource ? toFolder(resource) : null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Update an existing folder
 */
export async function updateFolder(
  id: string,
  userId: string,
  updates: UpdateFolderRequest
): Promise<Folder | null> {
  const container = await getFoldersContainer();

  try {
    const { resource: doc } = await container
      .item(id, userId)
      .read<FolderDocument>();

    if (!doc) return null;

    const updated: FolderDocument = {
      ...doc,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const { resource } = await container.item(id, userId).replace(updated);
    return toFolder(resource as FolderDocument);
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a folder and clear folderId from associated recordings
 */
export async function deleteFolder(
  id: string,
  userId: string
): Promise<boolean> {
  const foldersContainer = await getFoldersContainer();

  try {
    // 1. Clear folderId from all recordings in this folder
    const recordingsContainer = await getRecordingsContainer();
    const { resources: recordings } = await recordingsContainer.items
      .query({
        query:
          "SELECT c.id FROM c WHERE c.userId = @userId AND c.folderId = @folderId",
        parameters: [
          { name: "@userId", value: userId },
          { name: "@folderId", value: id },
        ],
      })
      .fetchAll();

    for (const rec of recordings) {
      const { resource: fullRec } = await recordingsContainer
        .item(rec.id, userId)
        .read();
      if (fullRec) {
        await recordingsContainer.item(rec.id, userId).replace({
          ...fullRec,
          folderId: undefined,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // 2. Delete the folder
    await foldersContainer.item(id, userId).delete();
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return false;
    }
    throw error;
  }
}
