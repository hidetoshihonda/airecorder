"use client";

import { LogIn, Mic, History, Sparkles, Github } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import { Button } from "./button";

interface AuthGateModalProps {
  /** モーダルの開閉状態 */
  isOpen: boolean;
  /** モーダルを閉じるコールバック */
  onClose: () => void;
  /** ブロックされたアクション名（例: "録音を開始"） */
  action?: string | null;
}

const LOGIN_URL = "/.auth/login/github";

const BENEFITS = [
  { icon: Mic, text: "録音と文字起こし" },
  { icon: History, text: "録音履歴の保存・管理" },
  { icon: Sparkles, text: "AI議事録の生成" },
] as const;

/**
 * 認証ゲートモーダル
 *
 * 未ログインユーザーが保護されたアクションを実行しようとした際に表示される。
 * GitHubログインへの誘導を行い、ログイン後は元のページに戻る。
 */
export function AuthGateModal({ isOpen, onClose, action }: AuthGateModalProps) {
  const handleLogin = () => {
    // 現在のページをログイン後のリダイレクト先に設定
    const redirectUri = encodeURIComponent(window.location.pathname);
    window.location.href = `${LOGIN_URL}?post_login_redirect_uri=${redirectUri}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
            <LogIn className="h-8 w-8 text-blue-600" />
          </div>
          <DialogTitle className="text-xl">ログインが必要です</DialogTitle>
          <DialogDescription className="text-base">
            {action ? (
              <>
                「<span className="font-medium text-gray-700">{action}</span>
                」するにはログインしてください
              </>
            ) : (
              "この機能を使用するにはログインしてください"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {/* ログインボタン */}
          <Button
            onClick={handleLogin}
            className="w-full gap-2 bg-gray-900 text-white hover:bg-gray-800"
            size="lg"
          >
            <Github className="h-5 w-5" />
            GitHubでログイン
          </Button>

          {/* ログインのメリット */}
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="mb-3 text-sm font-medium text-gray-700">
              ログインすると以下が可能になります:
            </p>
            <ul className="space-y-2">
              {BENEFITS.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-center gap-2 text-sm text-gray-600"
                >
                  <Icon className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* 閉じるリンク */}
          <p className="text-center text-xs text-gray-500">
            <button
              onClick={onClose}
              className="underline hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded"
            >
              閉じる
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
