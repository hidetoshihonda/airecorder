import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getUserSettings, updateUserSettings } from "../services/settingsService";
import { ApiResponse, UserSettingsDocument, UserSettings } from "../models";

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
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    body: JSON.stringify(data),
  };
}

// GET/PUT /api/settings - ユーザー設定の取得・更新
app.http("settings", {
  methods: ["GET", "PUT", "OPTIONS"],
  authLevel: "anonymous",
  route: "settings",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    // GET - 設定取得
    if (request.method === "GET") {
      const userId = request.query.get("userId");
      if (!userId) {
        return jsonResponse(
          { success: false, error: "userId is required" },
          400
        );
      }

      try {
        const result = await getUserSettings(userId);
        return jsonResponse<UserSettingsDocument>({ success: true, data: result });
      } catch (error) {
        return jsonResponse(
          { success: false, error: (error as Error).message },
          500
        );
      }
    }

    // PUT - 設定更新
    if (request.method === "PUT") {
      try {
        const body = (await request.json()) as {
          userId: string;
          settings: Partial<UserSettings>;
        };

        if (!body.userId) {
          return jsonResponse(
            { success: false, error: "userId is required" },
            400
          );
        }

        if (!body.settings || Object.keys(body.settings).length === 0) {
          return jsonResponse(
            { success: false, error: "settings is required" },
            400
          );
        }

        const result = await updateUserSettings(body.userId, body.settings);
        return jsonResponse<UserSettingsDocument>({ success: true, data: result });
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
