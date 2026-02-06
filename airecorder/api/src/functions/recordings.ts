import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  createRecording,
  getRecording,
  updateRecording,
  deleteRecording,
  listRecordings,
} from "../services/recordingService";
import {
  ApiResponse,
  Recording,
  CreateRecordingRequest,
  UpdateRecordingRequest,
  PaginatedResponse,
} from "../models";
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ms-client-principal",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}

// Helper function to create JSON response
function jsonResponse<T>(
  data: ApiResponse<T>,
  status: number = 200,
  corsHeaders?: Record<string, string>
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(corsHeaders || {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }),
    },
    body: JSON.stringify(data),
  };
}

// List recordings
app.http("listRecordings", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/list",
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders };
    }

    try {
      // 認証必須 - ヘッダーからユーザーID取得
      const principal = requireAuth(request);
      const userId = principal.userId;

      const page = parseInt(request.query.get("page") || "1", 10);
      const limit = parseInt(request.query.get("limit") || "20", 10);
      const search = request.query.get("search") || undefined;

      context.log(`listRecordings: userId=${userId}, page=${page}, limit=${limit}`);

      const result = await listRecordings(userId, page, limit, search);
      return jsonResponse<PaginatedResponse<Recording>>(
        { success: true, data: result },
        200,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      context.error("listRecordings error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500,
        corsHeaders
      );
    }
  },
});

// Create recording
app.http("createRecording", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings",
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

      const body = (await request.json()) as Omit<CreateRecordingRequest, 'userId'>;

      if (!body.title || !body.sourceLanguage) {
        return jsonResponse(
          { success: false, error: "title and sourceLanguage are required" },
          400,
          corsHeaders
        );
      }

      context.log(`createRecording: userId=${userId}, title=${body.title}`);

      // userIdは認証情報から取得（リクエストボディは無視）
      const recording = await createRecording({ ...body, userId });
      return jsonResponse<Recording>(
        { success: true, data: recording },
        201,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      context.error("createRecording error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500,
        corsHeaders
      );
    }
  },
});

// Get, Update, Delete recording by ID
app.http("recordingById", {
  methods: ["GET", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{id}",
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders };
    }

    const id = request.params.id;

    try {
      // 認証必須
      const principal = requireAuth(request);
      const userId = principal.userId;

      // Handle GET - Get recording by ID
      if (request.method === "GET") {
        const recording = await getRecording(id!, userId);
        
        // 存在しないか、他人のレコード → 404（存在を隠す）
        if (!recording || recording.userId !== userId) {
          return jsonResponse(
            { success: false, error: "Recording not found" },
            404,
            corsHeaders
          );
        }

        return jsonResponse<Recording>(
          { success: true, data: recording },
          200,
          corsHeaders
        );
      }

      // Handle PUT - Update recording
      if (request.method === "PUT") {
        // 所有権確認
        const existing = await getRecording(id!, userId);
        if (!existing || existing.userId !== userId) {
          return jsonResponse(
            { success: false, error: "Recording not found" },
            404,
            corsHeaders
          );
        }

        const body = (await request.json()) as UpdateRecordingRequest;
        const recording = await updateRecording(id!, userId, body);

        return jsonResponse<Recording>(
          { success: true, data: recording! },
          200,
          corsHeaders
        );
      }

      // Handle DELETE - Delete recording
      if (request.method === "DELETE") {
        // 所有権確認
        const existing = await getRecording(id!, userId);
        if (!existing || existing.userId !== userId) {
          return jsonResponse(
            { success: false, error: "Recording not found" },
            404,
            corsHeaders
          );
        }

        await deleteRecording(id!, userId);
        return jsonResponse(
          { success: true },
          200,
          corsHeaders
        );
      }

      return jsonResponse(
        { success: false, error: "Method not allowed" },
        405,
        corsHeaders
      );
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return handleAuthError(error, corsHeaders);
      }
      context.error("recordingById error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500,
        corsHeaders
      );
    }
  },
});
