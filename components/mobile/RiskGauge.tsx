"use client";

import { useState } from "react";

export type GaugeZone = { upTo: number; className: string };

type Props = {
  label: string;
  /** Formatted value, or null when unknown. */
  display: string | null;
  /** Raw value used to position the marker. Null hides the marker. */
  value: number | null;
  min: number;
  max: number;
  zones: GaugeZone[];
  scaleLabels: [string, string, string];
  explanation: string;
  tone?: string;
  /** Optional reference line, e.g. beta 1.0 = "moves with the market". */
  tick?: number;
};

function markerPercent(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0) return 0;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

export function RiskGauge({
  label,
  display,
  value,
  min,
  max,
  zones,
  scaleLabels,
  explanation,
  tone,
  tick,
}: Props) {
  const [showExplanation, setShowExplanation] = useState(false);

  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowExplanation((v) => !v)}
          aria-expanded={showExplanation}
          className="inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400"
        >
          {label}
          <span
            aria-hidden
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[8px]"
          >
            i
          </span>
        </button>
        <span
          className={`font-mono text-base font-semibold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}
        >
          {display ?? "—"}
        </span>
      </div>

      <div className="relative mt-1 flex h-1.5 overflow-hidden rounded-full">
        {zones.map((z, i) => {
          const from = i === 0 ? min : zones[i - 1].upTo;
          const width = ((z.upTo - from) / (max - min)) * 100;
          return (
            <span
              key={z.upTo}
              className={z.className}
              style={{ width: `${width}%` }}
            />
          );
        })}
        {tick != null && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-slate-500/70 dark:bg-slate-400/70"
            style={{ left: `${markerPercent(tick, min, max)}%` }}
          />
        )}
      </div>
      {value != null && (
        <div className="relative h-0">
          <span
            aria-hidden
            className="absolute -top-[9px] h-3 w-[3px] -translate-x-1/2 rounded-sm bg-slate-900 ring-2 ring-white dark:bg-white dark:ring-slate-900"
            style={{ left: `${markerPercent(value, min, max)}%` }}
          />
        </div>
      )}

      {/* These read as the gauge's axis, not decoration — the muted
          slate-400/600 placeholder token measured 2.6:1 light / 2.4:1 dark,
          under WCAG AA. Use the same scale the holding row settled on. */}
      <div className="mt-2 flex justify-between font-mono text-[9px] text-slate-500 dark:text-slate-400">
        {scaleLabels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>

      {showExplanation && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
          {explanation}
        </p>
      )}
    </div>
  );
}
