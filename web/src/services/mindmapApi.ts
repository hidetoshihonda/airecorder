import { ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface GenerateMindmapInput {
  transcript: string;
  language?: string;
}

export interface MindmapResult {
  markdown: string;
}

class MindmapApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async generateMindmap(
    input: GenerateMindmapInput
  ): Promise<ApiResponse<MindmapResult>> {
    const url = `${this.baseUrl}/mindmap/generate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: `Parse error: ${text.substring(0, 100)}` };
        }
      }

      if (!response.ok) {
        return {
          error:
            (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return {
        data:
          (data?.data as MindmapResult) ||
          (data as unknown as MindmapResult),
      };
    } catch (error) {
      return {
        error: (error as Error).message || "Network error",
      };
    }
  }
}

export const mindmapApi = new MindmapApiService();
