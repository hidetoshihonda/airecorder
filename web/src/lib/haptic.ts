/**
 * Haptic Feedback ユーティリティ
 * iOS PWAでネイティブ風の触覚フィードバックを提供
 */

type HapticType = "light" | "medium" | "heavy" | "success" | "warning" | "error";

/**
 * ハプティクスフィードバックを発火
 * Navigator.vibrate APIが利用可能な場合にのみ実行
 */
export function haptic(type: HapticType = "light"): void {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;

  const patterns: Record<HapticType, number | number[]> = {
    light: 10,
    medium: 20,
    heavy: 30,
    success: [10, 50, 10],
    warning: [20, 50, 20],
    error: [30, 50, 30, 50, 30],
  };

  try {
    navigator.vibrate(patterns[type]);
  } catch {
    // 無視: 一部ブラウザではvibrate非対応
  }
}

/**
 * タップ時にハプティクスフィードバックを付与するイベントハンドラ
 */
export function withHaptic<T extends (...args: unknown[]) => void>(
  fn: T,
  type: HapticType = "light"
): T {
  return ((...args: unknown[]) => {
    haptic(type);
    fn(...args);
  }) as T;
}
