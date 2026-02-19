"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ActionSheetAction {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  onClick: () => void;
}

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: ActionSheetAction[];
  cancelLabel?: string;
}

export function ActionSheet({
  open,
  onClose,
  title,
  message,
  actions,
  cancelLabel = "キャンセル",
}: ActionSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/40"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
            }}
            className="fixed bottom-0 left-0 right-0 z-[101] px-2 pb-[calc(8px+env(safe-area-inset-bottom))]"
          >
            {/* Actions group */}
            <div className="overflow-hidden rounded-xl bg-white/95 backdrop-blur-xl dark:bg-gray-800/95">
              {/* Header */}
              {(title || message) && (
                <div className="border-b border-gray-200/50 px-4 py-3 text-center dark:border-gray-700/50">
                  {title && (
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {title}
                    </p>
                  )}
                  {message && (
                    <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      {message}
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              {actions.map((action, index) => (
                <button
                  key={index}
                  onClick={() => {
                    action.onClick();
                    onClose();
                  }}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 px-4 py-3 text-lg font-normal transition-colors",
                    "active:bg-gray-100 dark:active:bg-gray-700",
                    index > 0 && "border-t border-gray-200/50 dark:border-gray-700/50",
                    action.destructive
                      ? "text-red-500"
                      : "text-blue-600 dark:text-blue-400"
                  )}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>

            {/* Cancel button */}
            <button
              onClick={onClose}
              className={cn(
                "mt-2 w-full rounded-xl bg-white/95 px-4 py-3 text-lg font-semibold backdrop-blur-xl transition-colors",
                "text-blue-600 active:bg-gray-100",
                "dark:bg-gray-800/95 dark:text-blue-400 dark:active:bg-gray-700"
              )}
            >
              {cancelLabel}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
