"use client";

import { useSwipeBack } from "@/hooks/useSwipeBack";
import { useEffect, useState } from "react";

/**
 * PWAスタンドアロンモードでのみスワイプバックを有効化するコンポーネント
 */
export function SwipeBackProvider() {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(
      mq.matches || ("standalone" in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone === true)
    );
  }, []);

  useSwipeBack({ enabled: isStandalone });

  return null;
}
