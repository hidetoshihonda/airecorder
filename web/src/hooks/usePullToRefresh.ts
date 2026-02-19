"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  /** 引っ張り閾値(px)。デフォルト80 */
  threshold?: number;
  /** 最大引っ張り距離(px)。デフォルト120 */
  maxPull?: number;
  /** 有効/無効。デフォルトtrue */
  enabled?: boolean;
}

interface UsePullToRefreshReturn {
  pullDistance: number;
  isRefreshing: boolean;
  /** コンテナに付与するref */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** プルインジケーターのtranslateY値 */
  indicatorStyle: React.CSSProperties;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 120,
  enabled = true,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isDragging = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled || isRefreshing) return;
      const el = containerRef.current;
      if (!el || el.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      isDragging.current = true;
    },
    [enabled, isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging.current || !enabled || isRefreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0) {
        // 指数減衰: 引っ張るほど重くなる
        const dampened = Math.min(delta * 0.5, maxPull);
        setPullDistance(dampened);
        if (dampened > 10) {
          e.preventDefault();
        }
      }
    },
    [enabled, isRefreshing, maxPull]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
    setPullDistance(0);
  }, [pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  const indicatorStyle: React.CSSProperties = {
    transform: `translateY(${isRefreshing ? threshold * 0.5 : pullDistance}px)`,
    transition: isDragging.current ? "none" : "transform 0.3s ease",
  };

  return {
    pullDistance,
    isRefreshing,
    containerRef,
    indicatorStyle,
  };
}
