"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface UseAuthGateReturn {
  /**
   * 認証チェック付きアクション実行。
   * 認証済みなら true を返し、未認証ならモーダルを表示して false を返す。
   *
   * @param action - ブロックされたアクション名（モーダルに表示）
   */
  requireAuth: (action?: string) => boolean;
  /** モーダルの開閉状態 */
  isModalOpen: boolean;
  /** モーダルを閉じる */
  closeModal: () => void;
  /** ブロックされたアクション名 */
  blockedAction: string | null;
}

/**
 * 認証ゲートフック
 *
 * 保護されたアクション実行前に認証状態を確認し、
 * 未認証の場合はログイン誘導モーダルを表示する。
 *
 * @example
 * ```tsx
 * const { requireAuth, isModalOpen, closeModal, blockedAction } = useAuthGate();
 *
 * const handleStart = () => {
 *   if (!requireAuth("録音を開始")) return;
 *   // 認証済みの場合のみ実行される
 *   startRecording();
 * };
 *
 * return (
 *   <>
 *     <button onClick={handleStart}>録音開始</button>
 *     <AuthGateModal isOpen={isModalOpen} onClose={closeModal} action={blockedAction} />
 *   </>
 * );
 * ```
 */
export function useAuthGate(): UseAuthGateReturn {
  const { isAuthenticated } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [blockedAction, setBlockedAction] = useState<string | null>(null);

  const requireAuth = useCallback(
    (action?: string): boolean => {
      if (isAuthenticated) {
        return true;
      }

      setBlockedAction(action ?? null);
      setIsModalOpen(true);
      return false;
    },
    [isAuthenticated]
  );

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setBlockedAction(null);
  }, []);

  return {
    requireAuth,
    isModalOpen,
    closeModal,
    blockedAction,
  };
}
