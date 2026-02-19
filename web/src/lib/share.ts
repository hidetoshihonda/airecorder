/**
 * Web Share API ユーティリティ
 * ネイティブの共有シートを使ってコンテンツを共有する
 */

interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * Web Share APIが利用可能かチェック
 */
export function canShare(): boolean {
  return typeof navigator !== "undefined" && "share" in navigator;
}

/**
 * ネイティブ共有ダイアログを開く
 * Web Share API非対応の場合はクリップボードにコピー
 */
export async function share(options: ShareOptions): Promise<boolean> {
  if (canShare()) {
    try {
      await navigator.share(options);
      return true;
    } catch (err) {
      // ユーザーがキャンセルした場合
      if (err instanceof Error && err.name === "AbortError") {
        return false;
      }
      // フォールバック
    }
  }

  // フォールバック: クリップボードにコピー
  const text = options.text || options.url || options.title || "";
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * テキストをクリップボードにコピー
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback: execCommand
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}
