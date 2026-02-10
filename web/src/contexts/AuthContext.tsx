"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { User, UserSettings } from "@/types";
import { fetchUserSettings, saveUserSettings } from "@/services/settingsApi";
import { recordingsApi } from "@/services/recordingsApi";

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
    console.log("[Auth] Using cached auth info:", authCache.user?.id);
    return authCache.user;
  }

  try {
    const response = await fetch("/.auth/me");
    if (!response.ok) {
      console.log("[Auth] /.auth/me returned not ok:", response.status);
      authCache = { user: null, timestamp: Date.now() };
      return null;
    }

    const data = await response.json();
    console.log("[Auth] /.auth/me response:", JSON.stringify(data, null, 2));
    const principal = data?.clientPrincipal;

    if (!principal || !principal.userId) {
      console.log("[Auth] No clientPrincipal or userId");
      authCache = { user: null, timestamp: Date.now() };
      return null;
    }

    console.log("[Auth] clientPrincipal:", JSON.stringify(principal, null, 2));

    const user: User = {
      id: principal.userId,
      email: principal.userDetails || "",
      displayName: principal.userDetails || "User",
      settings: defaultSettings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    console.log("[Auth] Created user with id:", user.id);
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
  
  // デバウンス用のタイマーRef (Issue #44)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // ログイン時にAPIから設定を取得してマージ (Issue #44 クロスデバイス対応)
  useEffect(() => {
    if (!user?.id || !settingsLoaded) return;
    
    let cancelled = false;
    (async () => {
      try {
        const remoteSettings = await fetchUserSettings(user.id);
        if (!cancelled) {
          if (remoteSettings?.settings) {
            // APIの設定で上書き（クロスデバイス同期）
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSettings(remoteSettings.settings);
            // localStorageもキャッシュとして更新
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(remoteSettings.settings));
          } else {
            // APIに設定がない場合、現在のローカル設定をAPIに保存
            await saveUserSettings(user.id, settings);
          }
        }
      } catch (error) {
        console.error("[Settings] Failed to fetch remote settings:", error);
        // エラー時はlocalStorageの設定をそのまま使用
      }
    })();
    
    return () => { cancelled = true; };
  }, [user?.id, settingsLoaded]); // settings を依存に入れるとループするので注意

  // Fetch SWA auth info on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authUser = await fetchSwaAuthInfo();
        if (!cancelled) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setUser(authUser);
          // recordingsApiにユーザーIDを設定（セキュリティ修正 Issue #57）
          recordingsApi.setUserId(authUser?.id || null);
        }
      } catch {
        // Auth fetch failed — treat as unauthenticated
        recordingsApi.setUserId(null);
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
      // Save to localStorage (オフライン対応)
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save settings to localStorage:", error);
      }
      return updated;
    });
    
    // ログイン中ならAPIにも保存（デバウンス: 500ms）(Issue #44)
    if (user?.id) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await saveUserSettings(user.id, newSettings);
        } catch (error) {
          console.error("Failed to save settings to API:", error);
        }
      }, 500);
    }
  }, [user?.id]);

  // クリーンアップ: コンポーネントアンマウント時にタイマーをクリア
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
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
    // recordingsApiからユーザーIDをクリア（セキュリティ修正 Issue #57）
    recordingsApi.setUserId(null);
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
