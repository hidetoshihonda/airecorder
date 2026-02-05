import { Summary, ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface GenerateSummaryInput {
  transcript: string;
  language?: string;
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

      const data = await response.json();

      if (!response.ok) {
        return {
          error: data.error || `HTTP error ${response.status}`,
        };
      }

      return {
        data: data.data || data,
      };
    } catch (error) {
      return {
        error: (error as Error).message || "Network error",
      };
    }
  }
}

export const summaryApi = new SummaryApiService();
