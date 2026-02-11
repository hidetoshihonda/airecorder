import { Summary, ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface GenerateSummaryInput {
  transcript: string;
  language?: string;
  templateId?: string;
  customPrompt?: string;
}

class SummaryApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async generateSummary(input: GenerateSummaryInput): Promise<ApiResponse<Summary>> {
    const url = `${this.baseUrl}/summary/generate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      // 安全なJSONパース
      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.error('[SummaryAPI] JSON parse error:', parseError);
          return { error: `SERVER_PARSE_ERROR: ${text.substring(0, 100)}` };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return {
        data: ((data?.data as Summary) || data) as Summary,
      };
    } catch (error) {
      console.error('[SummaryAPI] Request error:', error);
      return {
        error: (error as Error).message || "Network error",
      };
    }
  }
}

export const summaryApi = new SummaryApiService();
