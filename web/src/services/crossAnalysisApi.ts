import { CrossAnalysisResult, ApiResponse } from "@/types";

// API base URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface CrossAnalysisInput {
  recordingIds: string[];
  userId: string;
  analysisType: "summary" | "trends" | "action-tracking" | "full";
  dateRange?: { start: string; end: string };
}

class CrossAnalysisApiService {
  private baseUrl: string;
  private userId: string | null = null;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  setUserId(userId: string | null) {
    this.userId = userId;
  }

  async analyze(
    input: Omit<CrossAnalysisInput, "userId">
  ): Promise<ApiResponse<CrossAnalysisResult>> {
    if (!this.userId) {
      return { error: "認証が必要です。ログインしてください。" };
    }

    const url = `${this.baseUrl}/recordings/cross-analysis`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          userId: this.userId,
        }),
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.error("[CrossAnalysisAPI] JSON parse error:", parseError);
          return { error: "Invalid JSON response from server" };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return {
        data: ((data?.data as CrossAnalysisResult) || data) as CrossAnalysisResult,
      };
    } catch (error) {
      console.error("[CrossAnalysisAPI] Request error:", error);
      return {
        error: (error as Error).message || "Network error",
      };
    }
  }
}

export const crossAnalysisApi = new CrossAnalysisApiService();
