import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";

// Helper function to create JSON response
function jsonResponse<T>(
  data: { success: boolean; data?: T; error?: string },
  status: number = 200
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    body: JSON.stringify(data),
  };
}

// Generate SAS token for uploading audio files
app.http("generateUploadSas", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "blob/upload-sas",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const fileName = request.query.get("fileName");
      if (!fileName) {
        return jsonResponse(
          { success: false, error: "fileName is required" },
          400
        );
      }

      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return jsonResponse(
          { success: false, error: "Storage not configured" },
          500
        );
      }

      // Parse connection string
      const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
      const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];

      if (!accountName || !accountKey) {
        return jsonResponse(
          { success: false, error: "Invalid storage configuration" },
          500
        );
      }

      const containerName = "recordings";
      const blobName = `${Date.now()}-${fileName}`;

      // Create SAS token
      const sharedKeyCredential = new StorageSharedKeyCredential(
        accountName,
        accountKey
      );

      const startsOn = new Date();
      const expiresOn = new Date(startsOn.getTime() + 30 * 60 * 1000); // 30 minutes

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse("cw"), // create and write
          startsOn,
          expiresOn,
        },
        sharedKeyCredential
      ).toString();

      const blobUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}`;

      return jsonResponse({
        success: true,
        data: {
          blobUrl,
          sasToken,
          fullUrl: `${blobUrl}?${sasToken}`,
          expiresOn: expiresOn.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: message }, 500);
    }
  },
});

// Generate SAS token for downloading/playing audio files
app.http("generateDownloadSas", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "blob/download-sas",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const blobUrl = request.query.get("blobUrl");
      if (!blobUrl) {
        return jsonResponse(
          { success: false, error: "blobUrl is required" },
          400
        );
      }

      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return jsonResponse(
          { success: false, error: "Storage not configured" },
          500
        );
      }

      // Parse connection string
      const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
      const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];

      if (!accountName || !accountKey) {
        return jsonResponse(
          { success: false, error: "Invalid storage configuration" },
          500
        );
      }

      // Extract container and blob name from URL
      const urlParts = new URL(blobUrl);
      const pathParts = urlParts.pathname.split("/").filter(Boolean);
      const containerName = pathParts[0];
      const blobName = pathParts.slice(1).join("/");

      // Create SAS token for read
      const sharedKeyCredential = new StorageSharedKeyCredential(
        accountName,
        accountKey
      );

      const startsOn = new Date();
      const expiresOn = new Date(startsOn.getTime() + 60 * 60 * 1000); // 1 hour

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse("r"), // read only
          startsOn,
          expiresOn,
        },
        sharedKeyCredential
      ).toString();

      return jsonResponse({
        success: true,
        data: {
          fullUrl: `${blobUrl}?${sasToken}`,
          expiresOn: expiresOn.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: message }, 500);
    }
  },
});

// List recordings from blob storage
app.http("listBlobs", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "blob/list",
  handler: async (
    _request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (_request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return jsonResponse(
          { success: false, error: "Storage not configured" },
          500
        );
      }

      const blobServiceClient =
        BlobServiceClient.fromConnectionString(connectionString);
      const containerClient =
        blobServiceClient.getContainerClient("recordings");

      // Ensure container exists
      await containerClient.createIfNotExists();

      const blobs: Array<{
        name: string;
        url: string;
        createdOn: string | undefined;
        size: number | undefined;
      }> = [];

      for await (const blob of containerClient.listBlobsFlat()) {
        blobs.push({
          name: blob.name,
          url: `${containerClient.url}/${blob.name}`,
          createdOn: blob.properties.createdOn?.toISOString(),
          size: blob.properties.contentLength,
        });
      }

      return jsonResponse({
        success: true,
        data: blobs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: message }, 500);
    }
  },
});
