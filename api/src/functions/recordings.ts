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
  getUserTags,
} from "../services/recordingService";
import { processTranscriptCorrection } from "../services/transcriptCorrectionService";
import { processTranslationCorrection } from "../services/translationCorrectionService";
import {
  ApiResponse,
  Recording,
  CreateRecordingRequest,
  UpdateRecordingRequest,
  PaginatedResponse,
} from "../models";

// Helper function to create JSON response
function jsonResponse<T>(
  data: ApiResponse<T>,
  status: number = 200
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const userId = request.query.get("userId");
      if (!userId) {
        return jsonResponse(
          { success: false, error: "userId is required" },
          400
        );
      }

      const page = parseInt(request.query.get("page") || "1", 10);
      const limit = parseInt(request.query.get("limit") || "20", 10);
      const search = request.query.get("search") || undefined;
      const folderId = request.query.get("folderId") || undefined;
      const tag = request.query.get("tag") || undefined;

      const result = await listRecordings(userId, page, limit, search, folderId, tag);
      return jsonResponse<PaginatedResponse<Recording>>({
        success: true,
        data: result,
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// List user tags (Issue #171)
app.http("listUserTags", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/tags",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const userId = request.query.get("userId");
      if (!userId) {
        return jsonResponse(
          { success: false, error: "userId is required" },
          400
        );
      }

      const tags = await getUserTags(userId);
      return jsonResponse<string[]>({
        success: true,
        data: tags,
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
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
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as CreateRecordingRequest;

      if (!body.userId || !body.title || !body.sourceLanguage) {
        return jsonResponse(
          {
            success: false,
            error: "userId, title, and sourceLanguage are required",
          },
          400
        );
      }

      const recording = await createRecording(body);
      return jsonResponse<Recording>({ success: true, data: recording }, 201);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// Get, Update, or Delete recording by ID
app.http("recordingById", {
  methods: ["GET", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{id}",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;

    try {
      // GET: Get recording by ID
      if (request.method === "GET") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const recording = await getRecording(id!, userId);
        if (!recording) {
          return jsonResponse(
            { success: false, error: "Recording not found" },
            404
          );
        }

        return jsonResponse<Recording>({ success: true, data: recording });
      }

      // PUT: Update recording
      if (request.method === "PUT") {
        const body = (await request.json()) as UpdateRecordingRequest & {
          userId?: string;
        };
        const userId = body.userId || request.query.get("userId");

        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const recording = await updateRecording(id!, userId, body);
        if (!recording) {
          return jsonResponse(
            { success: false, error: "Recording not found" },
            404
          );
        }

        return jsonResponse<Recording>({ success: true, data: recording });
      }

      // DELETE: Delete recording
      if (request.method === "DELETE") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const deleted = await deleteRecording(id!, userId);
        if (!deleted) {
          return jsonResponse(
            { success: false, error: "Recording not found" },
            404
          );
        }

        return jsonResponse({ success: true });
      }

      return jsonResponse(
        { success: false, error: "Method not allowed" },
        405
      );
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// POST /api/recordings/{id}/correct - 手動で補正を再実行 (Issue #70)
app.http("correctRecording", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{id}/correct",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;
    const userId = request.query.get("userId");

    if (!userId) {
      return jsonResponse(
        { success: false, error: "userId is required" },
        400
      );
    }

    try {
      // 並行実行ガード: processing 中はリトライを拒否 (Issue #103 堅牢性強化)
      const recording = await getRecording(id!, userId);
      if (!recording) {
        return jsonResponse(
          { success: false, error: "Recording not found" },
          404
        );
      }

      if (recording.correctionStatus === "processing") {
        return jsonResponse(
          { success: false, error: "Correction already in progress" },
          409
        );
      }

      if (!recording.transcript?.fullText) {
        return jsonResponse(
          { success: false, error: "No transcript to correct" },
          400
        );
      }

      // 補正処理を非同期でキック
      processTranscriptCorrection(id!, userId).catch((err) => {
        console.error(`[Correction] Manual correction failed for ${id}:`, err);
      });

      return jsonResponse({
        success: true,
        data: { message: "Correction started" },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// POST /api/recordings/{id}/correct-translation - 翻訳補正を手動で再実行 (Issue #125)
app.http("correctTranslation", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{id}/correct-translation",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;
    const userId = request.query.get("userId");

    if (!userId) {
      return jsonResponse(
        { success: false, error: "userId is required" },
        400
      );
    }

    try {
      const recording = await getRecording(id!, userId);
      if (!recording) {
        return jsonResponse(
          { success: false, error: "Recording not found" },
          404
        );
      }

      if (recording.translationCorrectionStatus === "processing") {
        return jsonResponse(
          { success: false, error: "Translation correction already in progress" },
          409
        );
      }

      if (!recording.translations || Object.keys(recording.translations).length === 0) {
        return jsonResponse(
          { success: false, error: "No translations to correct" },
          400
        );
      }

      // 翻訳補正処理を非同期でキック
      processTranslationCorrection(id!, userId).catch((err) => {
        console.error(`[TranslationCorrection] Manual correction failed for ${id}:`, err);
      });

      return jsonResponse({
        success: true,
        data: { message: "Translation correction started" },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
