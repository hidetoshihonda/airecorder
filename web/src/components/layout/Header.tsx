"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, History, Settings, User, LogOut, Globe, ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale, AppLocale } from "@/contexts/I18nContext";

const UI_LANGUAGES: { code: AppLocale; flag: string; name: string }[] = [
  { code: "ja", flag: "🇯🇵", name: "日本語" },
  { code: "en", flag: "🇺🇸", name: "English" },
  { code: "es", flag: "🇪🇸", name: "Español" },
];

const navigation = [
  { key: "recording" as const, href: "/", icon: Mic },
  { key: "history" as const, href: "/history", icon: History },
  { key: "settings" as const, href: "/settings", icon: Settings },
];

/** 現在のパスに対応するページタイトルを返す */
function usePageTitle() {
  const pathname = usePathname();
  const t = useTranslations("Header");
  if (pathname === "/") return t("recording");
  if (pathname.startsWith("/history")) return t("history");
  if (pathname.startsWith("/settings")) return t("settings");
  return "AI Recorder";
}

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const { user, isAuthenticated, login, logout } = useAuth();
  const { locale, setLocale } = useLocale();
  const t = useTranslations("Header");
  const tc = useTranslations("Common");
  const pageTitle = usePageTitle();

  // 詳細ページ（/history/[id]）の場合は戻るボタンを表示
  const isDetailPage = pathname.startsWith("/history/") && pathname !== "/history";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-gray-200 dark:border-gray-700",
        // モバイル: iOS風グラスモーフィズムNavBar
        "bg-white/80 backdrop-blur-xl dark:bg-gray-900/80",
        // デスクトップ: ソリッド背景
        "md:bg-white md:backdrop-blur-none md:dark:bg-gray-900",
        // Safe Area上部対応
        "pt-[env(safe-area-inset-top)]"
      )}
    >
      {/* モバイル NavBar (iOS風 44px) */}
      <div className="flex h-11 items-center justify-between px-4 md:hidden">
        {/* 左: 戻るボタン or ロゴ */}
        <div className="flex w-16 items-center">
          {isDetailPage ? (
            <Link
              href="/history"
              className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400"
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="text-sm">戻る</span>
            </Link>
          ) : (
            <span className="text-sm font-semibold text-gray-900 dark:text-white">AI</span>
          )}
        </div>

        {/* 中央: ページタイトル */}
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">
          {pageTitle}
        </h1>

        {/* 右: ユーザーアイコン */}
        <div className="flex w-16 items-center justify-end">
          {isAuthenticated && user ? (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            >
              {user.displayName?.charAt(0) || "U"}
            </button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => login()}
              className="h-7 px-2 text-xs text-blue-600 dark:text-blue-400"
            >
              {tc("login")}
            </Button>
          )}
        </div>
      </div>

      {/* デスクトップ NavBar */}
      <nav className="mx-auto hidden max-w-7xl items-center justify-between px-4 py-3 sm:px-6 md:flex lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900 dark:text-white">AI Recorder</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="flex items-center gap-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.key)}
              </Link>
            );
          })}
        </div>

        {/* User Menu + Language Switcher */}
        <div className="flex items-center gap-2">
          {/* Language Switcher */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="gap-1 text-gray-600 dark:text-gray-300"
            >
              <Globe className="h-4 w-4" />
              {UI_LANGUAGES.find(l => l.code === locale)?.flag}
            </Button>
            {langMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  {UI_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => { setLocale(lang.code); setLangMenuOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                        locale === lang.code
                          ? "bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-400"
                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                      )}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {isAuthenticated && user ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-1.5 dark:bg-gray-800">
                <User className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{user.displayName}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout()}
                className="gap-1 text-gray-600 hover:text-red-600 dark:text-gray-300 dark:hover:text-red-400"
              >
                <LogOut className="h-4 w-4" />
                {tc('logout')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => login()}
              className="gap-1"
            >
              <User className="h-4 w-4" />
              {tc('login')}
            </Button>
          )}
        </div>
      </nav>

      {/* モバイル: ユーザーメニュー（アバタータップで展開） */}
      {mobileMenuOpen && (
        <div className="border-t border-gray-200 bg-white/95 backdrop-blur-xl md:hidden dark:border-gray-700 dark:bg-gray-900/95">
          <div className="space-y-1 px-4 py-3">
            {/* Language Switcher */}
            <div className="flex items-center gap-2 px-3 py-2">
              <Globe className="h-4 w-4 text-gray-400" />
              <div className="flex gap-1">
                {UI_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { setLocale(lang.code); }}
                    className={cn(
                      "rounded-md px-2 py-1 text-sm transition-colors",
                      locale === lang.code
                        ? "bg-blue-100 text-blue-700 font-medium dark:bg-blue-900/40 dark:text-blue-400"
                        : "text-gray-500 dark:text-gray-400"
                    )}
                  >
                    {lang.flag}
                  </button>
                ))}
              </div>
            </div>

            {isAuthenticated && user ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                  <User className="h-4 w-4" />
                  {user.displayName}
                </div>
                <button
                  onClick={() => { logout(); setMobileMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <LogOut className="h-4 w-4" />
                  {tc('logout')}
                </button>
              </>
            ) : (
              <button
                onClick={() => { login(); setMobileMenuOpen(false); }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              >
                <User className="h-4 w-4" />
                {tc('login')}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
