"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, History, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const navigation = [
  { key: "recording" as const, href: "/", icon: Mic },
  { key: "history" as const, href: "/history", icon: History },
  { key: "settings" as const, href: "/settings", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("Header");

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 md:hidden",
        "border-t border-gray-200 dark:border-gray-700",
        "bg-white/80 backdrop-blur-xl dark:bg-gray-900/80",
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <div className="flex items-center justify-around px-2">
        {navigation.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                "active:scale-95",
                isActive
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-500 dark:text-gray-400"
              )}
            >
              <item.icon
                className={cn(
                  "h-6 w-6 transition-colors",
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-400 dark:text-gray-500"
                )}
                strokeWidth={isActive ? 2.5 : 1.5}
              />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
