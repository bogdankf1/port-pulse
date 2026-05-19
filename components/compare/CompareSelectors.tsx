"use client";

import type { Portfolio } from "@/types";
import { BENCHMARKS } from "@/lib/compare";

type Props = {
  portfolios: Portfolio[];
  selectedPortfolios: Set<string>;
  onTogglePortfolio: (id: string) => void;
  selectedBenchmarks: Set<string>;
  onToggleBenchmark: (id: string) => void;
};

export function CompareSelectors({
  portfolios,
  selectedPortfolios,
  onTogglePortfolio,
  selectedBenchmarks,
  onToggleBenchmark,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      {portfolios.length > 0 && (
        <Row label="Portfolios">
          {portfolios.map((p) => (
            <Chip
              key={p.id}
              label={p.name || "Portfolio"}
              checked={selectedPortfolios.has(p.id)}
              onChange={() => onTogglePortfolio(p.id)}
            />
          ))}
        </Row>
      )}
      <Row label="Benchmarks">
        {BENCHMARKS.map((b) => (
          <Chip
            key={b.id}
            label={b.label}
            checked={selectedBenchmarks.has(b.id)}
            onChange={() => onToggleBenchmark(b.id)}
          />
        ))}
      </Row>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide transition-colors ${
        checked
          ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "border-slate-300 bg-white/60 text-slate-500 hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}
