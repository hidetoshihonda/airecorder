"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { X, Share, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// --- standalone state via useSyncExternalStore ---
function subscribeStandalone(callback: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function getStandaloneSnapshot() {
  const mq = window.matchMedia("(display-mode: standalone)");
  return mq.matches || ("standalone" in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone === true);
}
function getServerStandaloneSnapshot() { return true; } // server: assume standalone → hide banner

// --- dismissed state via useSyncExternalStore ---
function subscribeDismissed(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function getDismissedSnapshot() {
  const dismissedAt = localStorage.getItem("pwa-install-dismissed");
  if (!dismissedAt) return false;
  const diff = Date.now() - parseInt(dismissedAt);
  return diff < 7 * 24 * 60 * 60 * 1000;
}
function getServerDismissedSnapshot() { return false; }

/**
 * PWAホーム画面追加促進バナー
 */
export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const isStandalone = useSyncExternalStore(subscribeStandalone, getStandaloneSnapshot, getServerStandaloneSnapshot);
  const dismissed = useSyncExternalStore(subscribeDismissed, getDismissedSnapshot, getServerDismissedSnapshot);

  useEffect(() => {
    // Android Chrome: beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari: 3秒後にガイド表示
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isIOS && isSafari && !isStandalone) {
      timer = setTimeout(() => setShowIOSGuide(true), 3000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      if (timer) clearTimeout(timer);
    };
  }, [isStandalone]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowIOSGuide(false);
    setDeferredPrompt(null);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
    // Trigger storage event for useSyncExternalStore
    window.dispatchEvent(new Event("storage"));
  }, []);

  // 非表示条件
  if (isStandalone || dismissed) return null;
  if (!deferredPrompt && !showIOSGuide) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 250 }}
        className={cn(
          "fixed bottom-[calc(49px+env(safe-area-inset-bottom)+8px)] left-3 right-3 z-[60] md:bottom-4 md:left-auto md:right-4 md:max-w-sm",
          "rounded-2xl bg-white/95 p-4 shadow-2xl backdrop-blur-xl",
          "border border-gray-200",
          "dark:border-gray-700 dark:bg-gray-800/95"
        )}
      >
        <button
          onClick={handleDismiss}
          className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X className="h-4 w-4" />
        </button>

        {deferredPrompt ? (
          /* Android Chrome */
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/40">
              <Plus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                ホーム画面に追加
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                アプリのようにすぐアクセスできます
              </p>
              <button
                onClick={handleInstall}
                className="mt-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                インストール
              </button>
            </div>
          </div>
        ) : (
          /* iOS Safari ガイド */
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/40">
              <Share className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                ホーム画面に追加
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Share className="inline h-3 w-3" />
                  共有ボタン
                </span>
                を押して
                <span className="font-medium"> 「ホーム画面に追加」</span>
                をタップ
              </p>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
