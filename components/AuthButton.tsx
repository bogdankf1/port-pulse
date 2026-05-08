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
        className="group inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-60"
        title="Sign out"
      >
        <span className="hidden sm:inline">{display}</span>
        <span className="sm:hidden">●</span>
        <span className="text-slate-500 group-hover:text-slate-300">
          {busy ? "…" : "Sign out"}
        </span>
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
      className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-60"
    >
      <GoogleIcon />
      <span>{busy ? "Opening…" : "Sign in with Google"}</span>
    </button>
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
