"use client";

import Link from "next/link";
import { AuthButton } from "./AuthButton";
import { ThemeToggle } from "./ThemeToggle";
import { MarketStatusPill } from "./MarketStatusPill";

export function Navbar() {
  return (
    <header
      className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-[#0a0e1a]/85"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <Link
            href="/"
            className="font-mono text-base font-medium uppercase tracking-[0.18em] text-slate-900 transition-colors hover:text-black dark:text-slate-100 dark:hover:text-white sm:text-[15px]"
          >
            Port Pulse
          </Link>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <MarketStatusPill />
          <ThemeToggle />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
