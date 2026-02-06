import {
  Recording,
  Transcript,
  Translation,
  Summary,
  ApiResponse,
  PaginatedResponse,
} from "@/types";

// API base URL - BYOF経由でアクセスするため相対パスを使用
const API_BASE_URL = "/api";

export interface CreateRecordingInput {
  title: string;
  sourceLanguage: string;
  duration: number;
  audioUrl?: string;
  transcript?: Transcript;
  translations?: Record<string, Translation>;
}

export interface UpdateRecordingInput {
  title?: string;
  transcript?: Transcript;
  translations?: Record<string, Translation>;
  summary?: Summary;
  tags?: string[];
  status?: Recording["status"];
}

class RecordingsApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        credentials: 'include',  // 認証Cookie送信に必要
      });

      // 401の場合はログインページへ
      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          window.location.href = '/.auth/login/github?post_login_redirect_uri=' + 
            encodeURIComponent(window.location.pathname);
        }
        return { error: 'Authentication required' };
      }

      // 空レスポンスの安全なハンドリング
      const text = await response.text();
      let data: Record<string, unknown> | null = null;
      
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.error('[RecordingsAPI] JSON parse error:', parseError);
          return { error: 'Invalid JSON response from server' };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return {
        data: ((data?.data as T) || data) as T,
      };
    } catch (error) {
      console.error('[RecordingsAPI] Request error:', error);
      return {
        error: (error as Error).message || "Network error",
      };
    }
  }

  async listRecordings(
    page: number = 1,
    limit: number = 20,
    search?: string
  ): Promise<ApiResponse<PaginatedResponse<Recording>>> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    if (search) {
      params.append("search", search);
    }

    return this.request<PaginatedResponse<Recording>>(
      `/recordings/list?${params.toString()}`
    );
  }

  async getRecording(id: string): Promise<ApiResponse<Recording>> {
    return this.request<Recording>(`/recordings/${id}`);
  }

  async createRecording(
    input: CreateRecordingInput
  ): Promise<ApiResponse<Recording>> {
    return this.request<Recording>("/recordings", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateRecording(
    id: string,
    input: UpdateRecordingInput
  ): Promise<ApiResponse<Recording>> {
    return this.request<Recording>(`/recordings/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  async deleteRecording(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/recordings/${id}`, {
      method: "DELETE",
    });
  }

  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request<{ status: string }>("/health");
  }
}

// Singleton instance
export const recordingsApi = new RecordingsApiService();
