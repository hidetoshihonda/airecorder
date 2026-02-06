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
import {
  requireAuth,
  handleAuthError,
  AuthenticationError,
  AuthorizationError,
} from "../utils/auth";

// CORS設定
const ALLOWED_ORIGINS = [
  "https://proud-rock-06bba6200.2.azurestaticapps.net",
  "http://localhost:3000",
  "http://localhost:4280"
];

function getCorsHeaders(request: HttpRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ms-client-principal",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}

// Helper function to create JSON response
function jsonResponse<T>(
  data: { success: boolean; data?: T; error?: string },
  status: number = 200,
  corsHeaders?: Record<string, string>
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(corsHeaders || {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }),
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
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders };
    }

    try {
      // 認証必須
      const principal = requireAuth(request);
      const userId = principal.userId;

      const fileName = request.query.get("fileName");
      if (!fileName) {
        return jsonResponse(
          { success: false, error: "fileName is required" },
          400,
          corsHeaders
        );
      }

      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return jsonResponse(
          { success: false, error: "Storage not configured" },
          500,
          corsHeaders
        );
      }

      // Parse connection string
      const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
      const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];

      if (!accountName || !accountKey) {
        return jsonResponse(
          { success: false, error: "Invalid storage configuration" },
          500,
          corsHeaders
        );
      }

      const containerName = "recordings";
      // パスにuserIdを含める: recordings/{userId}/{timestamp}-{fileName}
      const blobName = `${userId}/${Date.now()}-${fileName}`;

      context.log(`generateUploadSas: userId=${userId}, blobName=${blobName}`);

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

      return jsonResponse(
        {
          success: true,
          data: {
            blobUrl,
            sasToken,
            fullUrl: `${blobUrl}?${sasToken}`,
            expiresOn: expiresOn.toISOString(),
          },
        },
        200,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      context.error("generateUploadSas error:", error);
      return jsonResponse({ success: false, error: message }, 500, corsHeaders);
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
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders };
    }

    try {
      // 認証必須
      const principal = requireAuth(request);
      const userId = principal.userId;

      const blobUrl = request.query.get("blobUrl");
      if (!blobUrl) {
        return jsonResponse(
          { success: false, error: "blobUrl is required" },
          400,
          corsHeaders
        );
      }

      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return jsonResponse(
          { success: false, error: "Storage not configured" },
          500,
          corsHeaders
        );
      }

      // Parse connection string
      const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
      const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];

      if (!accountName || !accountKey) {
        return jsonResponse(
          { success: false, error: "Invalid storage configuration" },
          500,
          corsHeaders
        );
      }

      // Extract container and blob name from URL
      const urlParts = new URL(blobUrl);
      const pathParts = urlParts.pathname.split("/").filter(Boolean);
      const containerName = pathParts[0];
      const blobName = pathParts.slice(1).join("/");

      // 所有権確認: blobNameが {userId}/ で始まるか確認
      if (!blobName.startsWith(`${userId}/`)) {
        context.warn(`Access denied: userId=${userId} tried to access blob=${blobName}`);
        return jsonResponse(
          { success: false, error: "Access denied" },
          404,  // 存在を隠すため404
          corsHeaders
        );
      }

      context.log(`generateDownloadSas: userId=${userId}, blobName=${blobName}`);

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

      return jsonResponse(
        {
          success: true,
          data: {
            fullUrl: `${blobUrl}?${sasToken}`,
            expiresOn: expiresOn.toISOString(),
          },
        },
        200,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      context.error("generateDownloadSas error:", error);
      return jsonResponse({ success: false, error: message }, 500, corsHeaders);
    }
  },
});

// List recordings from blob storage
app.http("listBlobs", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "blob/list",
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders };
    }

    try {
      // 認証必須
      const principal = requireAuth(request);
      const userId = principal.userId;

      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return jsonResponse(
          { success: false, error: "Storage not configured" },
          500,
          corsHeaders
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

      // ユーザーのprefixでフィルタ: {userId}/
      const prefix = `${userId}/`;
      context.log(`listBlobs: userId=${userId}, prefix=${prefix}`);

      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        blobs.push({
          name: blob.name,
          url: `${containerClient.url}/${blob.name}`,
          createdOn: blob.properties.createdOn?.toISOString(),
          size: blob.properties.contentLength,
        });
      }

      return jsonResponse(
        {
          success: true,
          data: blobs,
        },
        200,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      context.error("listBlobs error:", error);
      return jsonResponse({ success: false, error: message }, 500, corsHeaders);
    }
  },
});
