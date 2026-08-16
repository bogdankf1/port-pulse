"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ModalShell } from "./ModalShell";

type Props = {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  busyLabel = "Working…",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
  }, [open, busy, onCancel]);

  if (!open) return null;

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  const actionClass = destructive
    ? "bg-red-600 hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400"
    : "bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400";

  return (
    <ModalShell
      onClose={onCancel}
      labelledBy="confirm-modal-title"
      disabled={busy}
    >
      <div className="relative w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <h2
          id="confirm-modal-title"
          className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          {title}
        </h2>
        <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          {body}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => {
              if (!busy) onCancel();
            }}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-60 lg:min-h-0 dark:text-slate-400 dark:hover:text-slate-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`inline-flex min-h-[44px] items-center rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60 lg:min-h-0 ${actionClass}`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
