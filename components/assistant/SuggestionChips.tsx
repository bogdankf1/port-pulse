"use client";

import { useEffect, useState } from "react";
import { pickStarters } from "@/lib/assistant/prompts";

type Props = { onPick: (prompt: string) => void };

export function SuggestionChips({ onPick }: Props) {
  // Picked after mount, never during render: randomising in render would make
  // the server and client markup disagree.
  const [prompts, setPrompts] = useState<string[]>([]);
  useEffect(() => {
    // react-hooks/set-state-in-effect objects to the extra render this costs.
    // That render is the point: `Math.random()` may not run during render or
    // the server and client markup disagree. One mount-time render is the
    // cheapest hydration-safe way to get a random pick.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrompts(pickStarters(3));
  }, []);

  if (prompts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="rounded-lg border border-slate-300 px-3 py-2.5 text-left font-mono text-[13px] text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-900/60"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
