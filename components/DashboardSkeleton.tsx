"use client";

/**
 * Loading placeholders for the dashboard.
 *
 * Deliberately targeted rather than a full mirror of every panel: these cover
 * the parts that are actually network-bound and whose arrival would otherwise
 * shift the layout — the hero block, the sparkline area, and the holdings rows.
 * The sector and risk panels are not skeletoned; they mount after holdings
 * resolve and render their own loading states.
 *
 * Every dimension here is copied from the real component it stands in for, so
 * the swap to content is a fill rather than a jump. If those change, change
 * these: PortfolioHero (`px-4 pb-3 pt-1`, 28px total, 72px chart, 34px chips),
 * SortChips (`px-4 py-2`, 34px), HoldingRow (`min-h-[56px] px-4 py-2.5`, 28px mark).
 */

const MOBILE_ROWS = 7;
const DESKTOP_ROWS = 8;

function Bar({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200/80 dark:bg-slate-800 ${className}`}
    />
  );
}

export function MobileDashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading portfolio">
      {/* Hero — matches PortfolioHero's stack so the total lands in place */}
      <section className="px-4 pb-3 pt-1">
        <Bar className="h-7 w-52" />
        <Bar className="mt-2.5 h-3 w-64" />
        <Bar className="mt-2 h-[72px] w-full" />
        <div className="mt-1 flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Bar key={i} className="h-[34px] flex-1" />
          ))}
        </div>
      </section>

      {/* Sort chips */}
      <div className="flex gap-2 px-4 py-2">
        <Bar className="h-[34px] w-16" />
        <Bar className="h-[34px] w-14" />
        <Bar className="h-[34px] w-14" />
        <Bar className="h-[34px] w-20" />
      </div>

      {/* Holding rows */}
      <div className="border-t border-slate-200 dark:border-slate-800/70">
        {Array.from({ length: MOBILE_ROWS }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[56px] items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800/70"
          >
            <Bar className="h-7 w-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <Bar className="h-3.5 w-20" />
              <Bar className="mt-1.5 h-3 w-28" />
            </div>
            <div className="shrink-0">
              <Bar className="ml-auto h-3.5 w-16" />
              <Bar className="ml-auto mt-1.5 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DesktopDashboardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading portfolio"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800/70 dark:bg-slate-900/40"
    >
      {Array.from({ length: DESKTOP_ROWS }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-slate-200 px-4 py-3 last:border-b-0 dark:border-slate-800/70"
        >
          <Bar className="h-6 w-6 shrink-0" />
          <Bar className="h-3.5 w-16" />
          <Bar className="h-3 w-44" />
          <Bar className="ml-auto h-3.5 w-14" />
          <Bar className="h-3.5 w-20" />
          <Bar className="h-3.5 w-20" />
          <Bar className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}
