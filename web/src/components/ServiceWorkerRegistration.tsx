"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[SW] Registered:", reg.scope);

        // 更新検知
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "activated" &&
              navigator.serviceWorker.controller
            ) {
              // 新バージョンが利用可能
              // ユーザーに通知（静かに。confirm は避ける）
              console.log("[SW] New version available");
            }
          });
        });
      })
      .catch((err) => console.error("[SW] Registration failed:", err));
  }, []);

  return null;
}
