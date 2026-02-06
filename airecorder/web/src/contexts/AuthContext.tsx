"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { User, UserSettings } from "@/types";
import { 
  getAuthInfo, 
  isAuthenticated as checkAuth, 
  getUserId, 
  getUserName,
  getLoginUrl,
  getLogoutUrl,
  clearAuthCache
} from "@/lib/auth";

interface AuthContextType {
  // User state
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  
  // User settings
  settings: UserSettings;
  updateSettings: (settings: Partial<UserSettings>) => void;
  
  // Auth actions
  login: (redirectUri?: string) => void;
  logout: () => void;
  refreshAuth: () => Promise<void>;
}

const defaultSettings: UserSettings = {
  defaultSourceLanguage: "ja-JP",
  defaultTargetLanguages: ["en-US"],
  theme: "system",
  autoSaveRecordings: true,
  audioQuality: "high",
  noiseSuppression: true,
};

const SETTINGS_STORAGE_KEY = "airecorder-settings";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings>(() => {
    // Load settings from localStorage on initial render (client-side only)
    if (typeof window !== "undefined") {
      try {
        const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          return { ...defaultSettings, ...parsed };
        }
      } catch (error) {
        console.error("Failed to load settings from localStorage:", error);
      }
    }
    return defaultSettings;
  });

  // 認証状態を確認
  const checkAuthStatus = useCallback(async (forceRefresh = false) => {
    try {
      const authInfo = await getAuthInfo(forceRefresh);
      
      if (checkAuth(authInfo)) {
        const userName = getUserName(authInfo) || 'User';
        setUser({
          id: getUserId(authInfo)!,
          email: userName,
          displayName: userName,
          settings: defaultSettings,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回マウント時に認証状態を確認
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const isAuthenticated = user !== null;

  const updateSettings = useCallback((newSettings: Partial<UserSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      // Save to localStorage
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save settings to localStorage:", error);
      }
      return updated;
    });
  }, []);

  // ログイン - SWAのログインページにリダイレクト
  const login = useCallback((redirectUri?: string) => {
    window.location.href = getLoginUrl(redirectUri);
  }, []);

  // ログアウト - SWAのログアウトページにリダイレクト
  const logout = useCallback(() => {
    clearAuthCache();
    window.location.href = getLogoutUrl();
  }, []);

  // 認証状態リフレッシュ
  const refreshAuth = useCallback(async () => {
    setIsLoading(true);
    await checkAuthStatus(true);
  }, [checkAuthStatus]);

  const value: AuthContextType = {
    user,
    setUser,
    isAuthenticated,
    isLoading,
    setIsLoading,
    settings,
    updateSettings,
    login,
    logout,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
