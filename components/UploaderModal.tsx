"use client";

import { Uploader } from "./Uploader";
import { ModalShell } from "./ModalShell";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function UploaderModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <ModalShell onClose={onClose} labelledBy="uploader-modal-title">
      <div className="relative w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="uploader-modal-title"
            className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Add screenshot
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 transition-colors hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 4l8 8M4 12l8-8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          New tickers will be merged into the active portfolio.
        </p>
        <Uploader mode="merge" onComplete={onClose} />
      </div>
    </ModalShell>
  );
}
