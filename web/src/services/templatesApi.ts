import { CustomTemplate, ApiResponse } from "@/types";

// API base URL - use environment variable or default to Azure Functions URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

class TemplatesApiService {
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
   * List all custom templates for the current user
   */
  async list(): Promise<ApiResponse<CustomTemplate[]>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate[]>(
      `/templates?userId=${encodeURIComponent(this.userId!)}`
    );
  }

  /**
   * Create a new custom template
   */
  async create(
    template: Omit<CustomTemplate, "id" | "createdAt" | "updatedAt">
  ): Promise<ApiResponse<CustomTemplate>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate>("/templates", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId,
        ...template,
      }),
    });
  }

  /**
   * Update an existing custom template
   */
  async update(
    id: string,
    updates: Partial<Pick<CustomTemplate, "name" | "description" | "systemPrompt">>
  ): Promise<ApiResponse<CustomTemplate>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate>(
      `/templates/${id}?userId=${encodeURIComponent(this.userId!)}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    );
  }

  /**
   * Delete a custom template
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<void>(
      `/templates/${id}?userId=${encodeURIComponent(this.userId!)}`,
      { method: "DELETE" }
    );
  }

  /**
   * Bulk import templates (for migration from localStorage)
   */
  async bulkImport(
    templates: Array<{ name: string; description: string; systemPrompt: string }>
  ): Promise<ApiResponse<CustomTemplate[]>> {
    if (!this.isAuthenticated()) {
      return { error: "認証が必要です" };
    }
    return this.request<CustomTemplate[]>("/templates/bulk", {
      method: "POST",
      body: JSON.stringify({
        userId: this.userId,
        templates,
      }),
    });
  }
}

export const templatesApi = new TemplatesApiService();
