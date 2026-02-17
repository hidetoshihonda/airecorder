/**
 * Issue #126: リアルタイム補正 API サービス
 */
import { ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface RealtimeCorrectionInput {
  segments: Array<{ id: string; text: string }>;
  language: string;
  phraseList?: string[];
}

export interface CorrectionItem {
  id: string;
  original: string;
  corrected: string;
}

export interface CorrectionApiResponse {
  corrections: CorrectionItem[];
}

class CorrectionApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async correctSegments(
    input: RealtimeCorrectionInput,
    signal?: AbortSignal
  ): Promise<ApiResponse<CorrectionApiResponse>> {
    const url = `${this.baseUrl}/correction/realtime`;

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

      return { data: data?.data as CorrectionApiResponse };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { error: "REQUEST_ABORTED" };
      }
      return { error: (err as Error).message };
    }
  }
}

export const correctionApi = new CorrectionApiService();
