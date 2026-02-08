"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";

export type AppLocale = "ja" | "en" | "es";

const LOCALE_STORAGE_KEY = "airecorder-locale";

const LOCALE_MAP: Record<string, AppLocale> = {
  ja: "ja",
  "ja-JP": "ja",
  en: "en",
  "en-US": "en",
  "en-GB": "en",
  es: "es",
  "es-ES": "es",
  "es-MX": "es",
};

function detectBrowserLocale(): AppLocale {
  if (typeof navigator === "undefined") return "ja";
  const langs = navigator.languages || [navigator.language];
  for (const lang of langs) {
    const mapped = LOCALE_MAP[lang] || LOCALE_MAP[lang.split("-")[0]];
    if (mapped) return mapped;
  }
  return "ja";
}

function loadLocale(): AppLocale {
  if (typeof window === "undefined") return "ja";
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved && (saved === "ja" || saved === "en" || saved === "es")) {
      return saved;
    }
  } catch {
    // localStorage not available
  }
  return detectBrowserLocale();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messageCache: Record<string, any> = {};

async function loadMessages(locale: AppLocale) {
  if (messageCache[locale]) return messageCache[locale];
  const messages = (await import(`../../messages/${locale}.json`)).default;
  messageCache[locale] = messages;
  return messages;
}

interface I18nContextType {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
}

const I18nContext = createContext<I18nContextType>({
  locale: "ja",
  setLocale: () => {},
});

export function useLocale() {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(loadLocale);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [messages, setMessages] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load messages for current locale
  useEffect(() => {
    let cancelled = false;
    loadMessages(locale).then((msgs) => {
      if (!cancelled) {
        setMessages(msgs);
        setIsLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [locale]);

  // Update html lang attribute
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: AppLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // localStorage not available
    }
  }, []);

  if (!isLoaded || !messages) {
    // Show nothing while loading messages (prevents flash)
    return null;
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  );
}
