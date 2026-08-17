"use client";

import { useState } from "react";

type Props = {
  busy: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
};

export function Composer({ busy, onSend, onStop }: Props) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    onSend(text);
  }

  return (
    <div
      className="flex items-end gap-2 border-t border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/80"
      // py-3 is 0.75rem; the inset keeps the buttons clear of the iOS home
      // indicator in standalone mode, where it is non-zero.
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about your portfolio…"
        aria-label="Message"
        // 16px below lg: anything smaller makes iOS Safari zoom on focus.
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-base text-slate-900 outline-none transition-colors focus:border-emerald-500 lg:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-400"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-4 font-mono text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-4 font-mono text-xs font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          Send
        </button>
      )}
    </div>
  );
}
