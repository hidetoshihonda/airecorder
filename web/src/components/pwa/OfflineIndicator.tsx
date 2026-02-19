"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function subscribeOnlineStatus(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot() {
  return !navigator.onLine;
}

function getServerSnapshot() {
  return false;
}

/**
 * オフライン時にバナーを表示するコンポーネント
 */
export function OfflineIndicator() {
  const isOffline = useSyncExternalStore(subscribeOnlineStatus, getOnlineSnapshot, getServerSnapshot);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed left-0 right-0 top-[calc(env(safe-area-inset-top)+44px)] z-[60] md:top-14"
        >
          <div className="mx-auto flex max-w-sm items-center justify-center gap-2 rounded-b-lg bg-orange-500 px-4 py-1.5 text-xs font-medium text-white shadow-lg">
            <WifiOff className="h-3.5 w-3.5" />
            <span>オフラインです</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
