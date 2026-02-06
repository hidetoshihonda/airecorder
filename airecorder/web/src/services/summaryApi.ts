import { Summary, ApiResponse } from "@/types";

// BYOF経由でアクセスするため相対パスを使用
const API_BASE_URL = "/api";

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
        credentials: 'include',  // 認証Cookie送信
        body: JSON.stringify(input),
      });

      // 401の場合はログインページへ
      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          window.location.href = '/.auth/login/github?post_login_redirect_uri=' + 
            encodeURIComponent(window.location.pathname);
        }
        return { error: 'Authentication required' };
      }

      const text = await response.text();
      let data: Record<string, unknown> | null = null;
      
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.error('[SummaryAPI] JSON parse error:', parseError);
          return { error: 'Invalid JSON response from server' };
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
