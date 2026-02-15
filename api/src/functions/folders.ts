import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  listFolders,
  createFolder,
  getFolder,
  updateFolder,
  deleteFolder,
} from "../services/folderService";
import {
  ApiResponse,
  Folder,
  CreateFolderRequest,
  UpdateFolderRequest,
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

// GET/POST /api/folders - List or Create folders
app.http("folders", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "folders",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      // GET - List all folders
      if (request.method === "GET") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const folders = await listFolders(userId);
        return jsonResponse<Folder[]>({ success: true, data: folders });
      }

      // POST - Create a new folder
      if (request.method === "POST") {
        const body = (await request.json()) as CreateFolderRequest;

        if (!body.userId || !body.name) {
          return jsonResponse(
            { success: false, error: "userId and name are required" },
            400
          );
        }

        const folder = await createFolder(body);
        return jsonResponse<Folder>({ success: true, data: folder }, 201);
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

// GET/PUT/DELETE /api/folders/{id}
app.http("folderById", {
  methods: ["GET", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "folders/{id}",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;

    try {
      // GET - Get folder by ID
      if (request.method === "GET") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const folder = await getFolder(id!, userId);
        if (!folder) {
          return jsonResponse(
            { success: false, error: "Folder not found" },
            404
          );
        }

        return jsonResponse<Folder>({ success: true, data: folder });
      }

      // PUT - Update folder
      if (request.method === "PUT") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const body = (await request.json()) as UpdateFolderRequest;
        const updated = await updateFolder(id!, userId, body);

        if (!updated) {
          return jsonResponse(
            { success: false, error: "Folder not found" },
            404
          );
        }

        return jsonResponse<Folder>({ success: true, data: updated });
      }

      // DELETE - Delete folder
      if (request.method === "DELETE") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const deleted = await deleteFolder(id!, userId);
        if (!deleted) {
          return jsonResponse(
            { success: false, error: "Folder not found" },
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
