"use client";

import { useState, useSyncExternalStore } from "react";
import {
  getUser,
  getUserServerSnapshot,
  signInWithGoogle,
  signOut,
  subscribeUser,
} from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";

export function AuthButton() {
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured()) return null;

  if (user) {
    const display =
      (user.user_metadata?.full_name as string | undefined) ||
      user.email ||
      "Account";
    return (
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signOut();
          } finally {
            setBusy(false);
          }
        }}
        aria-label="Sign out"
        title={`Sign out${display ? ` (${display})` : ""}`}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white/60 px-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100 sm:px-2.5"
      >
        <span className="hidden max-w-[180px] truncate sm:inline">
          {display}
        </span>
        {busy ? (
          <span className="font-mono text-slate-500">…</span>
        ) : (
          <LogoutIcon />
        )}
      </button>
    );
  }

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signInWithGoogle();
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white/60 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
    >
      <GoogleIcon />
      <span className="hidden sm:inline">
        {busy ? "Opening…" : "Sign in with Google"}
      </span>
      <span className="sm:hidden">{busy ? "…" : "Sign in"}</span>
    </button>
  );
}

function LogoutIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-slate-500 dark:text-slate-400"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
