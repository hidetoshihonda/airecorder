"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, History, Settings, Menu, X, User, LogOut, Globe } from "lucide-react";
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

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const { user, isAuthenticated, login, logout } = useAuth();
  const { locale, setLocale } = useLocale();
  const t = useTranslations("Header");
  const tc = useTranslations("Common");

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">AI Recorder</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.key)}
              </Link>
            );
          })}
        </div>

        {/* User Menu + Language Switcher */}
        <div className="hidden md:flex md:items-center md:gap-2">
          {/* Language Switcher */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="gap-1 text-gray-600"
            >
              <Globe className="h-4 w-4" />
              {UI_LANGUAGES.find(l => l.code === locale)?.flag}
            </Button>
            {langMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  {UI_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => { setLocale(lang.code); setLangMenuOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                        locale === lang.code
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-gray-700 hover:bg-gray-50"
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
              <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-1.5">
                <User className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">{user.displayName}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout()}
                className="gap-1 text-gray-600 hover:text-red-600"
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

        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>
      </nav>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="border-t border-gray-200 bg-white md:hidden">
          <div className="space-y-1 px-4 py-3">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-base font-medium transition-colors",
                    isActive
                      ? "bg-gray-100 text-gray-900"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {t(item.key)}
                </Link>
              );
            })}
          </div>
          {/* Mobile User Info */}
          <div className="mt-3 border-t border-gray-200 pt-3">
            {isAuthenticated && user ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700">
                  <User className="h-4 w-4" />
                  {user.displayName}
                </div>
                <button
                  onClick={() => { logout(); setMobileMenuOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base font-medium text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-5 w-5" />
                  {tc('logout')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => { login(); setMobileMenuOpen(false); }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base font-medium text-blue-600 hover:bg-blue-50"
              >
                <User className="h-5 w-5" />
                {tc('login')}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
