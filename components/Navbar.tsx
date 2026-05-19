"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { AuthButton } from "./AuthButton";
import { ThemeToggle } from "./ThemeToggle";
import { useConnectionState } from "@/lib/finnhub";
import {
  getUser,
  getUserServerSnapshot,
  subscribeUser,
} from "@/lib/auth";
import type { ConnectionState } from "@/types";

export function Navbar() {
  const connState = useConnectionState();
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  const pathname = usePathname();
  const isSignedIn = Boolean(user);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-[#0a0e1a]/85">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <Link
            href="/"
            className="font-mono text-base font-bold tracking-tight text-slate-900 transition-colors hover:text-black dark:text-slate-100 dark:hover:text-white sm:text-lg"
          >
            Port Pulse
          </Link>
          {isSignedIn && (
            <Link
              href="/compare"
              aria-current={pathname === "/compare" ? "page" : undefined}
              className={`rounded-md px-2 py-1 font-mono text-[11px] font-medium tracking-wide transition-colors ${
                pathname === "/compare"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              Compare
            </Link>
          )}
          {connState !== "idle" && <ConnectionPill state={connState} />}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}

function ConnectionPill({ state }: { state: ConnectionState }) {
  const dotColor =
    state === "open" ? "bg-emerald-500" : "bg-amber-500 dark:bg-amber-400";

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 sm:px-2.5">
      <span className="relative inline-flex h-1.5 w-1.5">
        {state === "open" && (
          <span className="absolute inset-0 inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 dark:bg-emerald-400" />
        )}
        <span
          className={`relative inline-block h-1.5 w-1.5 rounded-full ${dotColor}`}
        />
      </span>
      <span className="hidden sm:inline">{labelFor(state)}</span>
    </div>
  );
}

function labelFor(state: ConnectionState): string {
  switch (state) {
    case "open":
      return "Live";
    case "connecting":
      return "Connecting…";
    case "closed":
      return "Reconnecting…";
    default:
      return "Idle";
  }
}
