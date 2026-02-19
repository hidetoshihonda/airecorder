"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * 実際のネットワーク到達性を確認する。
 * navigator.onLine はVPN環境やプロキシ環境で誤検知するため、
 * 実際にHEADリクエストを送って確認する。
 */
async function checkRealConnectivity(): Promise<boolean> {
  // navigator.onLine が true なら基本的にオンラインとみなす
  // （false の場合のみ実際のリクエストで再確認する）
  if (navigator.onLine) return true;

  try {
    // 軽量なHEADリクエストでキャッシュを回避して確認
    const resp = await fetch("/", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * オフライン時にバナーを表示するコンポーネント
 * navigator.onLine の誤検知（VPN等）を防ぐため、
 * 実際のネットワークリクエストで確認する。
 */
export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const verify = useCallback(async () => {
    const online = await checkRealConnectivity();
    setIsOffline(!online);
  }, []);

  useEffect(() => {
    // 初回チェック（少し遅延させて誤検知を防ぐ）
    timerRef.current = setTimeout(verify, 1000);

    const handleOnline = () => {
      // オンラインに戻ったら即座に解除
      setIsOffline(false);
    };

    const handleOffline = () => {
      // オフラインイベント発火時は実際に確認してから判定
      // 少し待ってから確認（一瞬の切断を無視）
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(verify, 2000);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 定期チェック（30秒ごと、navigator.onLine が false の場合のみ実行）
    const interval = setInterval(() => {
      if (!navigator.onLine) {
        verify();
      } else {
        setIsOffline(false);
      }
    }, 30000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (timerRef.current) clearTimeout(timerRef.current);
      clearInterval(interval);
    };
  }, [verify]);

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
