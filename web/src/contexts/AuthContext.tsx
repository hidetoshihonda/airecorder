"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { User, UserSettings } from "@/types";

interface AuthContextType {
  // User state
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  
  // User settings
  settings: UserSettings;
  settingsLoaded: boolean; // 設定がlocalStorageから読み込まれたかどうか
  updateSettings: (settings: Partial<UserSettings>) => void;
  
  // Auth actions (to be implemented with MSAL)
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const defaultSettings: UserSettings = {
  defaultSourceLanguage: "ja-JP",
  defaultTargetLanguages: ["en-US"],
  theme: "system",
  autoSaveRecordings: true,
  audioQuality: "high",
  noiseSuppression: true,
  enableSpeakerDiarization: false,
};

const SETTINGS_STORAGE_KEY = "airecorder-settings";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// Auth cache to avoid redundant /.auth/me calls
const AUTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let authCache: { user: User | null; timestamp: number } | null = null;

async function fetchSwaAuthInfo(): Promise<User | null> {
  // Return cached result if still valid
  if (authCache && Date.now() - authCache.timestamp < AUTH_CACHE_TTL) {
    return authCache.user;
  }

  try {
    const response = await fetch("/.auth/me");
    if (!response.ok) {
      authCache = { user: null, timestamp: Date.now() };
      return null;
    }

    const data = await response.json();
    const principal = data?.clientPrincipal;

    if (!principal || !principal.userId) {
      authCache = { user: null, timestamp: Date.now() };
      return null;
    }

    const user: User = {
      id: principal.userId,
      email: principal.userDetails || "",
      displayName: principal.userDetails || "User",
      settings: defaultSettings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    authCache = { user, timestamp: Date.now() };
    return user;
  } catch (error) {
    console.error("Failed to fetch auth info:", error);
    authCache = { user: null, timestamp: Date.now() };
    return null;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // 修正: SSRハイドレーション問題を回避するため、初期値はdefaultSettingsで固定
  // クライアントサイドでuseEffectを使ってlocalStorageから読み込む
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // クライアントサイドでのみlocalStorageから設定を読み込む (Issue #41 修正)
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch (error) {
      console.error("Failed to load settings from localStorage:", error);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettingsLoaded(true);
  }, []);

  // Fetch SWA auth info on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authUser = await fetchSwaAuthInfo();
        if (!cancelled) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setUser(authUser);
        }
      } catch {
        // Auth fetch failed — treat as unauthenticated
      } finally {
        if (!cancelled) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setIsLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // SWA built-in auth: redirect to GitHub login
  const login = useCallback(async () => {
    const redirectUri = encodeURIComponent(window.location.pathname);
    window.location.href = `/.auth/login/github?post_login_redirect_uri=${redirectUri}`;
  }, []);

  // SWA built-in auth: redirect to logout endpoint
  const logout = useCallback(async () => {
    authCache = null;
    setUser(null);
    window.location.href = "/.auth/logout?post_logout_redirect_uri=/";
  }, []);

  const value: AuthContextType = {
    user,
    setUser,
    isAuthenticated,
    isLoading,
    setIsLoading,
    settings,
    settingsLoaded,
    updateSettings,
    login,
    logout,
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
