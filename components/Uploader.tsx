"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { mergeIntoWatchlist } from "@/lib/storage";
import type { Ticker } from "@/types";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

type Mode = "first" | "merge";

type Progress = { done: number; total: number };

type FileResult =
  | { ok: true; name: string; tickers: Ticker[] }
  | { ok: false; name: string; error: string };

type Props = {
  mode?: Mode;
  onComplete?: () => void;
};

export function Uploader({ mode = "first", onComplete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  function validate(files: File[]): string | null {
    if (files.length === 0) return null;
    if (files.length > MAX_FILES) {
      return `Up to ${MAX_FILES} screenshots at a time.`;
    }
    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        return `"${file.name}" is not a supported image. Use PNG, JPEG, or WebP.`;
      }
      if (file.size > MAX_BYTES) {
        return `"${file.name}" is over 10 MB.`;
      }
    }
    return null;
  }

  async function parseOne(file: File): Promise<FileResult> {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          name: file.name,
          error: json.error || "Parse failed.",
        };
      }
      return { ok: true, name: file.name, tickers: json.tickers || [] };
    } catch (err) {
      return {
        ok: false,
        name: file.name,
        error: err instanceof Error ? err.message : "Upload failed.",
      };
    }
  }

  async function handleFiles(files: File[]) {
    setError(null);
    if (files.length === 0) return;

    const validationError = validate(files);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setProgress({ done: 0, total: files.length });

    const results = await Promise.all(
      files.map(async (file) => {
        const r = await parseOne(file);
        setProgress((p) =>
          p ? { ...p, done: p.done + 1 } : { done: 1, total: files.length },
        );
        return r;
      }),
    );

    const allTickers: Ticker[] = [];
    const failures: { name: string; error: string }[] = [];
    for (const r of results) {
      if (r.ok) {
        allTickers.push(...r.tickers);
      } else {
        failures.push({ name: r.name, error: r.error });
      }
    }

    if (failures.length === results.length) {
      setError(
        failures.length === 1
          ? failures[0].error
          : `All ${failures.length} uploads failed. Try again.`,
      );
      setBusy(false);
      setProgress(null);
      return;
    }

    if (allTickers.length === 0) {
      setError("No tickers found. Try clearer screenshots.");
      setBusy(false);
      setProgress(null);
      return;
    }

    mergeIntoWatchlist(allTickers);

    if (failures.length > 0) {
      console.warn(
        `Skipped ${failures.length} failed file(s):`,
        failures.map((f) => `${f.name}: ${f.error}`).join("; "),
      );
    }

    setBusy(false);
    setProgress(null);
    onComplete?.();
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) handleFiles(files);
    if (e.target) e.target.value = "";
  }

  return (
    <div className="w-full max-w-xl">
      <div
        className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-8 py-16 transition-colors ${
          dragOver
            ? "border-emerald-500/70 bg-emerald-500/5 dark:border-emerald-400/70 dark:bg-emerald-400/5"
            : "border-slate-300 bg-white/60 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-slate-500"
        } ${busy ? "pointer-events-none opacity-90" : "cursor-pointer"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={onChange}
        />
        <div className="relative z-10 text-center">
          {busy ? (
            <>
              <div className="mb-3 inline-block h-7 w-7 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent dark:border-emerald-400" />
              <div className="font-mono text-sm text-emerald-700 dark:text-emerald-300">
                {progress && progress.total > 1
                  ? `Parsed ${progress.done} of ${progress.total}…`
                  : "Reading screenshot…"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Claude Vision is parsing tickers
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex justify-center">
                <UploadIcon />
              </div>
              <div className="text-base font-medium text-slate-900 dark:text-slate-100 sm:text-lg">
                {mode === "merge"
                  ? "Drop more portfolio screenshots"
                  : "Drop your portfolio screenshots"}
              </div>
              <div className="mt-1 text-xs text-slate-500 sm:text-sm">
                or click to choose · up to {MAX_FILES} · PNG, JPEG, WebP · 10 MB
                each
              </div>
            </>
          )}
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className="text-slate-500 dark:text-slate-400"
    >
      <rect
        x="6"
        y="10"
        width="28"
        height="22"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M14 22 L20 16 L26 22"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 16 V28"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
