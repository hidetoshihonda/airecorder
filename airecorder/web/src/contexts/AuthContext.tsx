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

  // Mark loading as done after mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(false);
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

  // Placeholder auth functions - will be replaced with MSAL implementation
  const login = useCallback(async () => {
    // TODO: Implement MSAL login
    console.warn("Login not implemented yet");
  }, []);

  const logout = useCallback(async () => {
    // TODO: Implement MSAL logout
    setUser(null);
    console.warn("Logout not implemented yet");
  }, []);

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
