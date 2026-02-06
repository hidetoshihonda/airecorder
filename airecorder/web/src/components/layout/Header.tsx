"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, History, Settings, Menu, X, LogIn, LogOut, User } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Spinner } from "@/components/ui/spinner";

const navigation = [
  { name: "録音", href: "/recording", icon: Mic },
  { name: "履歴", href: "/history", icon: History },
  { name: "設定", href: "/settings", icon: Settings },
];

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isLoading, login, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AI Recorder</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </div>

        {/* Auth Section */}
        <div className="hidden md:flex md:items-center md:gap-3">
          {isLoading ? (
            <Spinner size="sm" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="h-4 w-4" />
                <span>{user.displayName}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="flex items-center gap-1"
              >
                <LogOut className="h-4 w-4" />
                ログアウト
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => login()}
              className="flex items-center gap-1"
            >
              <LogIn className="h-4 w-4" />
              ログイン
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
                  key={item.name}
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
                  {item.name}
                </Link>
              );
            })}
            
            {/* Mobile Auth */}
            <div className="border-t border-gray-200 pt-3 mt-3">
              {isLoading ? (
                <div className="flex justify-center py-2">
                  <Spinner size="sm" />
                </div>
              ) : user ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600">
                    <User className="h-4 w-4" />
                    <span>{user.displayName}</span>
                  </div>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <LogOut className="h-5 w-5" />
                    ログアウト
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    login();
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base font-medium text-blue-600 hover:bg-blue-50"
                >
                  <LogIn className="h-5 w-5" />
                  ログイン
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
