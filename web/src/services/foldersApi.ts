import { Folder, ApiResponse } from "@/types";

// API base URL - use environment variable or default to Azure Functions URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface CreateFolderInput {
  name: string;
  color?: string;
}

export interface UpdateFolderInput {
  name?: string;
  color?: string;
  sortOrder?: number;
}

class FoldersApiService {
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

  isAuthenticated(): boolean {
    return this.userId !== null && this.userId.length > 0;
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

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: "Invalid JSON response from server" };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return { data: data?.data as T };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }

  /**
   * List all folders for the current user
   */
  async list(): Promise<ApiResponse<Folder[]>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<Folder[]>(
      `/folders?userId=${encodeURIComponent(this.userId!)}`
    );
  }

  /**
   * Create a new folder
   */
  async create(input: CreateFolderInput): Promise<ApiResponse<Folder>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<Folder>("/folders", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId,
        ...input,
      }),
    });
  }

  /**
   * Update an existing folder
   */
  async update(
    id: string,
    updates: UpdateFolderInput
  ): Promise<ApiResponse<Folder>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<Folder>(
      `/folders/${id}?userId=${encodeURIComponent(this.userId!)}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    );
  }

  /**
   * Delete a folder (recordings in this folder will become uncategorized)
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<void>(
      `/folders/${id}?userId=${encodeURIComponent(this.userId!)}`,
      { method: "DELETE" }
    );
  }
}

export const foldersApi = new FoldersApiService();
