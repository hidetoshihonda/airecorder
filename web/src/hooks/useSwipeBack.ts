"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface UseSwipeBackOptions {
  /** スワイプ閾値(px)。デフォルト100 */
  threshold?: number;
  /** 有効/無効。デフォルトtrue */
  enabled?: boolean;
  /** エッジ幅(px): 画面左端からこの幅内でスワイプ開始時のみ有効。デフォルト30 */
  edgeWidth?: number;
}

/**
 * iOS風スワイプバックジェスチャー
 * 画面左端からの右スワイプで前のページに戻る
 */
export function useSwipeBack({
  threshold = 100,
  enabled = true,
  edgeWidth = 30,
}: UseSwipeBackOptions = {}) {
  const router = useRouter();
  const startX = useRef(0);
  const startY = useRef(0);
  const isEdgeSwipe = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (touch.clientX <= edgeWidth) {
        startX.current = touch.clientX;
        startY.current = touch.clientY;
        isEdgeSwipe.current = true;
      }
    },
    [enabled, edgeWidth]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!isEdgeSwipe.current || !enabled) return;
      isEdgeSwipe.current = false;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = Math.abs(touch.clientY - startY.current);

      // 水平方向のスワイプで、垂直移動が少ない場合のみ
      if (deltaX > threshold && deltaY < deltaX * 0.5) {
        router.back();
      }
    },
    [enabled, threshold, router]
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchEnd]);
}
