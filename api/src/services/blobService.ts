import {
  BlobServiceClient,
  ContainerClient,
  BlockBlobClient,
} from "@azure/storage-blob";

let blobServiceClient: BlobServiceClient | null = null;
let containerClient: ContainerClient | null = null;

const connectionString = process.env.BLOB_CONNECTION_STRING || "";
const containerName = process.env.BLOB_CONTAINER_NAME || "recordings";

export function getBlobServiceClient(): BlobServiceClient {
  if (!blobServiceClient) {
    if (!connectionString) {
      throw new Error("BLOB_CONNECTION_STRING is not configured");
    }
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  }
  return blobServiceClient;
}

export async function getContainerClient(): Promise<ContainerClient> {
  if (!containerClient) {
    const serviceClient = getBlobServiceClient();
    containerClient = serviceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();
  }
  return containerClient;
}

export async function uploadAudioBlob(
  userId: string,
  recordingId: string,
  audioData: Buffer,
  contentType: string = "audio/webm"
): Promise<string> {
  const container = await getContainerClient();
  const blobName = `${userId}/${recordingId}/audio.webm`;
  const blockBlobClient: BlockBlobClient = container.getBlockBlobClient(blobName);

  await blockBlobClient.upload(audioData, audioData.length, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
  });

  return blobName;
}

export async function getAudioBlobUrl(blobName: string): Promise<string> {
  const container = await getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);
  return blockBlobClient.url;
}

export async function deleteAudioBlob(blobName: string): Promise<void> {
  const container = await getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

export async function generateSasUrl(
  blobName: string,
  expiresInMinutes: number = 60
): Promise<string> {
  const container = await getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);

  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiresInMinutes * 60 * 1000);

  // For production, you should use proper SAS token generation
  // This is a simplified version that returns the direct URL
  // In production, configure proper access policies
  return blockBlobClient.url;
}
