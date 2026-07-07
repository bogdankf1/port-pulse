"use client";

import type { ReactNode } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";

type Props = {
  onClose: () => void;
  labelledBy: string;
  disabled?: boolean;
  children: ReactNode;
};

// Shared centered-modal overlay: dimmed backdrop, Escape + scroll-lock, and the
// standard positioning wrapper. Render it only while the modal is open.
export function ModalShell({ onClose, labelledBy, disabled = false, children }: Props) {
  useModalDismiss({ onClose, disabled });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
        onClick={() => {
          if (!disabled) onClose();
        }}
        tabIndex={-1}
      />
      {children}
    </div>
  );
}
