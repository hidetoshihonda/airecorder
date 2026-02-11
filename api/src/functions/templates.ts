import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  bulkImportTemplates,
} from "../services/templateService";
import {
  ApiResponse,
  CustomTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
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

// GET /api/templates - List all templates for a user
app.http("listTemplates", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates",
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

      const templates = await listTemplates(userId);
      return jsonResponse<CustomTemplate[]>({ success: true, data: templates });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// POST /api/templates - Create a new template
app.http("createTemplate", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as CreateTemplateRequest;

      if (!body.userId || !body.name || !body.systemPrompt) {
        return jsonResponse(
          { success: false, error: "userId, name, and systemPrompt are required" },
          400
        );
      }

      const template = await createTemplate(body);
      return jsonResponse<CustomTemplate>({ success: true, data: template }, 201);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// GET/PUT/DELETE /api/templates/{id}
app.http("templateById", {
  methods: ["GET", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates/{id}",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;

    try {
      // GET - Get template by ID
      if (request.method === "GET") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const template = await getTemplate(id!, userId);
        if (!template) {
          return jsonResponse(
            { success: false, error: "Template not found" },
            404
          );
        }

        return jsonResponse<CustomTemplate>({ success: true, data: template });
      }

      // PUT - Update template
      if (request.method === "PUT") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const body = (await request.json()) as UpdateTemplateRequest;
        const updated = await updateTemplate(id!, userId, body);

        if (!updated) {
          return jsonResponse(
            { success: false, error: "Template not found" },
            404
          );
        }

        return jsonResponse<CustomTemplate>({ success: true, data: updated });
      }

      // DELETE - Delete template
      if (request.method === "DELETE") {
        const userId = request.query.get("userId");
        if (!userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        const deleted = await deleteTemplate(id!, userId);
        if (!deleted) {
          return jsonResponse(
            { success: false, error: "Template not found" },
            404
          );
        }

        return jsonResponse({ success: true });
      }

      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});

// POST /api/templates/bulk - Bulk import templates (for migration)
app.http("bulkImportTemplates", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "templates/bulk",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as {
        userId: string;
        templates: Array<{ name: string; description: string; systemPrompt: string }>;
      };

      if (!body.userId || !Array.isArray(body.templates)) {
        return jsonResponse(
          { success: false, error: "userId and templates array are required" },
          400
        );
      }

      const imported = await bulkImportTemplates(body.userId, body.templates);
      return jsonResponse<CustomTemplate[]>({ success: true, data: imported }, 201);
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
