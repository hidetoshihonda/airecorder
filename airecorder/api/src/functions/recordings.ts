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

      const result = await listRecordings(userId, page, limit, search);
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

// Get, Update, Delete recording by ID - Combined into single function to avoid route conflicts
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

    // Handle GET - Get recording by ID
    if (request.method === "GET") {
      try {
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
      } catch (error) {
        return jsonResponse(
          { success: false, error: (error as Error).message },
          500
        );
      }
    }

    // Handle PUT - Update recording
    if (request.method === "PUT") {
      try {
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
      } catch (error) {
        return jsonResponse(
          { success: false, error: (error as Error).message },
          500
        );
      }
    }

    // Handle DELETE - Delete recording
    if (request.method === "DELETE") {
      try {
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
      } catch (error) {
        return jsonResponse(
          { success: false, error: (error as Error).message },
          500
        );
      }
    }

    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  },
});
