import type { ReactNode } from "react";
import type { InsightsSectionKey } from "@/types";

type SectionMeta = {
  title: string;
  Icon: () => ReactNode;
  accentBorder: string;
  accentText: string;
  accentBg: string;
};

const SECTION_META: Record<InsightsSectionKey, SectionMeta> = {
  concentration_risk: {
    title: "Concentration risk",
    Icon: AlertIcon,
    accentBorder: "border-l-amber-500",
    accentText: "text-amber-700 dark:text-amber-400",
    accentBg: "bg-amber-50/60 dark:bg-amber-500/[0.06]",
  },
  sector_tilt: {
    title: "Sector tilt",
    Icon: BalanceIcon,
    accentBorder: "border-l-violet-500",
    accentText: "text-violet-700 dark:text-violet-400",
    accentBg: "bg-violet-50/60 dark:bg-violet-500/[0.06]",
  },
  winners: {
    title: "Winners",
    Icon: TrendUpIcon,
    accentBorder: "border-l-emerald-500",
    accentText: "text-emerald-700 dark:text-emerald-400",
    accentBg: "bg-emerald-50/60 dark:bg-emerald-500/[0.06]",
  },
  losers: {
    title: "Losers",
    Icon: TrendDownIcon,
    accentBorder: "border-l-red-500",
    accentText: "text-red-700 dark:text-red-400",
    accentBg: "bg-red-50/60 dark:bg-red-500/[0.06]",
  },
  suggestion: {
    title: "Suggestion",
    Icon: SparkIcon,
    accentBorder: "border-l-sky-500",
    accentText: "text-sky-700 dark:text-sky-400",
    accentBg: "bg-sky-50/60 dark:bg-sky-500/[0.06]",
  },
};

export function SectionCard({
  sectionKey,
  body,
  active,
  loading,
}: {
  sectionKey: InsightsSectionKey;
  body: string;
  active: boolean;
  loading: boolean;
}) {
  const meta = SECTION_META[sectionKey];
  const trimmed = body.trim();
  const isDismissive =
    !!trimmed && /^(none|n\/a|n\.a\.?|—|-+)\.?$/i.test(trimmed);
  const hasContent = trimmed.length > 0 && !isDismissive;

  // While streaming and not yet started, show a faint placeholder card so the
  // user sees the structure laid out.
  if (!active && !hasContent) {
    if (loading) {
      return (
        <div
          className={`rounded-lg border border-slate-200 border-l-2 bg-white/40 px-4 py-3 opacity-60 dark:border-slate-800/70 dark:bg-slate-900/30 ${meta.accentBorder}`}
        >
          <SectionHeader meta={meta} muted />
        </div>
      );
    }
    // Not loading and empty — hide the card entirely.
    return null;
  }

  return (
    <div
      className={`rounded-lg border border-slate-200 border-l-2 px-4 py-3 dark:border-slate-800/70 ${meta.accentBorder} ${meta.accentBg}`}
    >
      <SectionHeader meta={meta} />
      <p className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-100">
        {hasContent ? trimmed : isDismissive ? <Muted>No findings.</Muted> : null}
        {active && (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] -translate-y-[1px] animate-pulse bg-slate-500 align-middle dark:bg-slate-400" />
        )}
      </p>
    </div>
  );
}

function SectionHeader({
  meta,
  muted = false,
}: {
  meta: SectionMeta;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={muted ? "text-slate-400 dark:text-slate-600" : meta.accentText}>
        <meta.Icon />
      </span>
      <span
        className={`font-mono text-[10px] uppercase tracking-widest ${
          muted ? "text-slate-400 dark:text-slate-600" : meta.accentText
        }`}
      >
        {meta.title}
      </span>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <span className="text-slate-400 dark:text-slate-500">{children}</span>
  );
}

function AlertIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function BalanceIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v18" />
      <path d="M5 21h14" />
      <path d="M6 8h12" />
      <path d="M6 8l-3 7a4 4 0 0 0 6 0z" />
      <path d="M18 8l-3 7a4 4 0 0 0 6 0z" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function TrendDownIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.6 5.6l2.1 2.1" />
      <path d="M16.3 16.3l2.1 2.1" />
      <path d="M5.6 18.4l2.1-2.1" />
      <path d="M16.3 7.7l2.1-2.1" />
    </svg>
  );
}
