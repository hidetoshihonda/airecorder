import { UserSettings } from "@/types";

// API base URL - use environment variable or default to Azure Functions URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface UserSettingsResponse {
  id: string;
  userId: string;
  settings: UserSettings;
  updatedAt: string;
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * ユーザー設定を取得
 */
export async function fetchUserSettings(
  userId: string
): Promise<UserSettingsResponse | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/settings?userId=${encodeURIComponent(userId)}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }

    const data: ApiResponse<UserSettingsResponse> = await response.json();
    return data.success && data.data ? data.data : null;
  } catch (error) {
    console.error("Failed to fetch user settings:", error);
    return null;
  }
}

/**
 * ユーザー設定を更新
 */
export async function saveUserSettings(
  userId: string,
  settings: Partial<UserSettings>
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, settings }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save settings: ${response.status}`);
    }

    const data: ApiResponse<UserSettingsResponse> = await response.json();
    return data.success;
  } catch (error) {
    console.error("Failed to save user settings:", error);
    return false;
  }
}
