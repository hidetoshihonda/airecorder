import {
  Recording,
  Transcript,
  Translation,
  Summary,
  ApiResponse,
  PaginatedResponse,
} from "@/types";

// API base URL - use environment variable or default to Azure Functions URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

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
  private userId: string | null = null;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  setUserId(userId: string | null) {
    this.userId = userId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  /**
   * 認証済みかどうかを確認
   * @returns userId が設定されている場合 true
   */
  isAuthenticated(): boolean {
    return this.userId !== null && this.userId.length > 0;
  }

  /**
   * 認証が必要な操作の前にuserIdを確認し、未設定ならエラーを返す
   */
  private requireAuth<T>(): ApiResponse<T> | null {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です。ログインしてください。" };
    }
    return null;
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
      });

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
    const authError = this.requireAuth<PaginatedResponse<Recording>>();
    if (authError) return authError;

    const params = new URLSearchParams({
      userId: this.userId!,
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
    const authError = this.requireAuth<Recording>();
    if (authError) return authError;

    const params = new URLSearchParams({ userId: this.userId! });
    return this.request<Recording>(`/recordings/${id}?${params.toString()}`);
  }

  async createRecording(
    input: CreateRecordingInput
  ): Promise<ApiResponse<Recording>> {
    const authError = this.requireAuth<Recording>();
    if (authError) return authError;

    return this.request<Recording>("/recordings", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId!,
        ...input,
      }),
    });
  }

  async updateRecording(
    id: string,
    input: UpdateRecordingInput
  ): Promise<ApiResponse<Recording>> {
    const authError = this.requireAuth<Recording>();
    if (authError) return authError;

    return this.request<Recording>(`/recordings/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        userId: this.userId!,
        ...input,
      }),
    });
  }

  async deleteRecording(id: string): Promise<ApiResponse<void>> {
    const authError = this.requireAuth<void>();
    if (authError) return authError;

    const params = new URLSearchParams({ userId: this.userId! });
    return this.request<void>(`/recordings/${id}?${params.toString()}`, {
      method: "DELETE",
    });
  }

  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request<{ status: string }>("/health");
  }
}

// Singleton instance
export const recordingsApi = new RecordingsApiService();
