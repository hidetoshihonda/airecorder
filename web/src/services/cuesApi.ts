import { ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface GenerateCuesInput {
  segments: string[];
  language: string;
  context?: string;
}

interface CueRaw {
  type: "concept" | "bio" | "suggestion";
  term?: string;
  definition?: string;
  context?: string;
  name?: string;
  description?: string;
  role?: string;
  question?: string;
  suggestion?: string;
  reasoning?: string;
}

export interface CuesApiResponse {
  cues: CueRaw[];
}

class CuesApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async generateCues(
    input: GenerateCuesInput,
    signal?: AbortSignal
  ): Promise<ApiResponse<CuesApiResponse>> {
    const url = `${this.baseUrl}/cues/generate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: `JSON parse error: ${text.substring(0, 100)}` };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return { data: data?.data as CuesApiResponse };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { error: "REQUEST_ABORTED" };
      }
      return { error: (err as Error).message };
    }
  }
}

export const cuesApi = new CuesApiService();
