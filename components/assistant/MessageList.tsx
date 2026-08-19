"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "@/types";
import { Markdown } from "./Markdown";

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
  get_portfolio_history: "tracing your portfolio's value",
  compare_portfolios: "comparing your portfolios",
  get_risk_metrics: "computing risk metrics",
  get_sector_breakdown: "breaking down sectors",
  get_correlation: "correlating your holdings",
  search_symbol: "looking up that ticker",
  get_company_fundamentals: "reading the fundamentals",
  get_earnings_calendar: "checking the earnings calendar",
  get_market_context: "checking the wider market",
  get_balances: "reading your balances",
  convert_currency: "converting currency",
  calculate: "doing the arithmetic",
  web_search: "searching the web",
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
  // Only the assistant's text is markdown. The user's own message is rendered
  // verbatim above, so nothing they type is ever reinterpreted as markup.
  return <Markdown content={content} />;
}
