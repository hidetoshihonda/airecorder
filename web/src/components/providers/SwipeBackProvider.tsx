"use client";

import { useSwipeBack } from "@/hooks/useSwipeBack";
import { useSyncExternalStore } from "react";

function getStandaloneSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  return mq.matches || ("standalone" in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone === true);
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/**
 * PWAスタンドアロンモードでのみスワイプバックを有効化するコンポーネント
 */
export function SwipeBackProvider() {
  const isStandalone = useSyncExternalStore(subscribe, getStandaloneSnapshot, getServerSnapshot);

  useSwipeBack({ enabled: isStandalone });

  return null;
}
