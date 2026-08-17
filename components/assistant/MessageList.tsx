"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "@/types";

type Props = {
  messages: AssistantMessage[];
  streaming: string;
  runningTool: string | null;
};

const TOOL_LABELS: Record<string, string> = {
  list_portfolios: "looking at your portfolios",
  get_portfolio: "reading your holdings",
  get_position: "checking that position",
  get_price_history: "pulling price history",
  get_risk_metrics: "computing risk metrics",
  get_sector_breakdown: "breaking down sectors",
};

export function MessageList({ messages, streaming, runningTool }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming, runningTool]);

  return (
    <div className="flex flex-col gap-5">
      {messages.map((m) => (
        <Bubble key={m.id} role={m.role} content={m.content} />
      ))}
      {streaming && <Bubble role="assistant" content={streaming} />}
      {runningTool && (
        <div
          role="status"
          className="font-mono text-[11px] uppercase tracking-widest text-slate-600 dark:text-slate-400"
        >
          {TOOL_LABELS[runningTool] ?? runningTool}…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  if (role === "user") {
    return (
      <div className="self-end rounded-2xl bg-slate-900 px-4 py-2.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
        {content}
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      {content}
    </div>
  );
}
