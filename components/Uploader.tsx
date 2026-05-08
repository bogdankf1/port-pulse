"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { mergeIntoWatchlist } from "@/lib/storage";
import type { Ticker } from "@/types";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

type Mode = "first" | "merge";

export function Uploader({ mode = "first" }: { mode?: Mode }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use PNG, JPEG, or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 10 MB.");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Parse failed.");
        setBusy(false);
        return;
      }
      const tickers: Ticker[] = json.tickers || [];
      if (tickers.length === 0) {
        setError("No tickers found. Try a clearer screenshot.");
        setBusy(false);
        return;
      }
      mergeIntoWatchlist(tickers);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="w-full max-w-xl">
      <div
        className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-8 py-16 transition-colors ${
          dragOver
            ? "border-emerald-400/70 bg-emerald-400/5"
            : "border-slate-700 bg-slate-900/40 hover:border-slate-500"
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
          className="hidden"
          onChange={onChange}
        />
        {preview && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={preview}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-15"
          />
        )}
        <div className="relative z-10 text-center">
          {busy ? (
            <>
              <div className="mb-3 inline-block h-7 w-7 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <div className="font-mono text-sm text-emerald-300">
                Reading screenshot…
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
              <div className="text-base font-medium text-slate-100 sm:text-lg">
                {mode === "merge"
                  ? "Drop another portfolio screenshot"
                  : "Drop your portfolio screenshot"}
              </div>
              <div className="mt-1 text-xs text-slate-500 sm:text-sm">
                or click to choose · PNG, JPEG, WebP · up to 10 MB
              </div>
            </>
          )}
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
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
      className="text-slate-400"
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
