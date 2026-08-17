"use client";

import { signInWithGoogle } from "@/lib/auth";

export function SignInPrompt() {
  return (
    <div className="mx-auto max-w-sm px-6 py-20 text-center">
      <h1 className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">
        Sign in to use the assistant
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        The assistant reads your saved portfolios to answer questions about
        them, so it needs an account. It only ever reads — it can&apos;t place
        trades or change anything.
      </p>
      <button
        type="button"
        // `next` sends OAuth back here rather than to the dashboard, so the
        // user lands on the thing they were trying to use.
        onClick={() => void signInWithGoogle("/assistant")}
        className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-4 font-mono text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Sign in with Google
      </button>
    </div>
  );
}
