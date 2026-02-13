"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";

/**
 * settings.theme と next-themes を全画面で同期するコンポーネント。
 * Providers.tsx 内で AuthProvider の子として配置する。
 */
export function ThemeSync() {
  const { settings, settingsLoaded } = useAuth();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (settingsLoaded) {
      setTheme(settings.theme);
    }
  }, [settings.theme, settingsLoaded, setTheme]);

  return null;
}
