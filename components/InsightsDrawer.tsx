"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  InsightsResponse,
  InsightsSectionKey,
  Ticker,
} from "@/types";
import { getPriceSync } from "@/lib/finnhub";

type Props = {
  open: boolean;
  onClose: () => void;
  tickers: Ticker[];
  portfolioName: string;
  portfolioId: string | null;
};

type CachedInsights = {
  insights: InsightsResponse;
  generatedAt: number;
};

const SESSION_PREFIX = "pp:insights:v2";
const SECTION_KEYS: InsightsSectionKey[] = [
  "concentration_risk",
  "sector_tilt",
  "winners",
  "losers",
  "suggestion",
];

function emptySections(): Record<InsightsSectionKey, string> {
  return {
    concentration_risk: "",
    sector_tilt: "",
    winners: "",
    losers: "",
    suggestion: "",
  };
}

function toResponse(
  sections: Record<InsightsSectionKey, string>,
): InsightsResponse {
  const trim = (s: string): string | null => {
    const t = s.trim();
    if (!t) return null;
    if (/^(none|n\/a|n\.a\.?|—|-+)\.?$/i.test(t)) return null;
    return t;
  };
  return {
    concentration_risk: trim(sections.concentration_risk),
    sector_tilt: trim(sections.sector_tilt),
    winners: trim(sections.winners),
    losers: trim(sections.losers),
    suggestion: trim(sections.suggestion),
  };
}

function hashHoldings(tickers: Ticker[]): string {
  const parts = tickers
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((t) => {
      const price = getPriceSync(t.symbol);
      return `${t.symbol}:${t.quantity ?? "_"}:${t.entryPrice ?? "_"}:${price ?? "_"}`;
    });
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function readCache(key: string): CachedInsights | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedInsights;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: CachedInsights) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

// Streaming text parser — split incoming text into per-section buffers based on
// the `<<key>>` markers the model emits. Resilient to chunks arriving mid-marker.
function makeSectionStream() {
  let buffer = "";
  let currentKey: InsightsSectionKey | null = null;
  const sections = emptySections();
  let errorMessage: string | null = null;

  function flushBuffer(streaming: boolean) {
    // Find the next marker in the buffer. If we find one, route everything
    // before it into the current section and switch.
    // Markers look like `<<key>>` on their own line (possibly with surrounding
    // whitespace/newlines). We use a permissive regex.
    const markerRe = /<<([a-z_]+)>>/;
    while (true) {
      const m = buffer.match(markerRe);
      if (!m || m.index === undefined) {
        // No marker in buffer.
        // If streaming, we might still receive a marker — keep a trailing
        // window of bytes that could be a partial marker. Otherwise flush all.
        if (streaming) {
          // A complete marker is at most ~24 chars (e.g. `<<concentration_risk>>`).
          // Keep the last 32 chars as the "could-be-partial" tail.
          const safeEnd = Math.max(0, buffer.length - 32);
          appendToCurrent(buffer.slice(0, safeEnd));
          buffer = buffer.slice(safeEnd);
        } else {
          appendToCurrent(buffer);
          buffer = "";
        }
        return;
      }
      // Text before the marker belongs to the current section.
      appendToCurrent(buffer.slice(0, m.index));
      const key = m[1];
      if ((SECTION_KEYS as string[]).includes(key)) {
        currentKey = key as InsightsSectionKey;
      } else if (key === "ERROR") {
        // Error inline. Capture the rest of the buffer as the message.
        errorMessage = buffer.slice(m.index + m[0].length).trim();
        buffer = "";
        return;
      } else {
        // Unknown marker — drop it; route subsequent text to current section.
      }
      buffer = buffer.slice(m.index + m[0].length);
    }
  }

  function appendToCurrent(text: string) {
    if (!currentKey || !text) return;
    sections[currentKey] += text;
  }

  return {
    ingest(chunk: string) {
      buffer += chunk;
      flushBuffer(true);
    },
    finish() {
      flushBuffer(false);
      return {
        sections: { ...sections },
        currentKey,
        error: errorMessage,
      };
    },
    snapshot() {
      return {
        sections: { ...sections },
        currentKey,
        error: errorMessage,
      };
    },
  };
}

export function InsightsDrawer({
  open,
  onClose,
  tickers,
  portfolioName,
  portfolioId,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<Record<InsightsSectionKey, string>>(
    emptySections,
  );
  const [activeKey, setActiveKey] = useState<InsightsSectionKey | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tickersHash = useMemo(() => hashHoldings(tickers), [tickers]);
  const cacheKey = useMemo(
    () => `${SESSION_PREFIX}:${portfolioId ?? "anon"}:${tickersHash}`,
    [portfolioId, tickersHash],
  );

  const fetchInsights = useCallback(
    async (skipCache: boolean) => {
      if (!skipCache) {
        const cached = readCache(cacheKey);
        if (cached) {
          setSections({
            concentration_risk: cached.insights.concentration_risk ?? "",
            sector_tilt: cached.insights.sector_tilt ?? "",
            winners: cached.insights.winners ?? "",
            losers: cached.insights.losers ?? "",
            suggestion: cached.insights.suggestion ?? "",
          });
          setActiveKey(null);
          setGeneratedAt(cached.generatedAt);
          setError(null);
          return;
        }
      }

      const payload = tickers
        .map((t) => {
          const price = getPriceSync(t.symbol);
          if (price == null || t.quantity == null) return null;
          return {
            symbol: t.symbol,
            name: t.name,
            quantity: t.quantity,
            entryPrice: t.entryPrice ?? null,
            currentPrice: price,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v != null);

      if (payload.length === 0) {
        setError("No holdings with quantity and live price to analyze.");
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      setSections(emptySections());
      setActiveKey(null);
      setGeneratedAt(null);

      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers: payload,
            portfolioName,
            portfolioId,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (!res.body) {
          throw new Error("No response body");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = makeSectionStream();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          parser.ingest(text);
          const snap = parser.snapshot();
          if (snap.error) {
            throw new Error(snap.error);
          }
          setSections({ ...snap.sections });
          setActiveKey(snap.currentKey);
        }

        const final = parser.finish();
        if (final.error) {
          throw new Error(final.error);
        }
        const response = toResponse(final.sections);
        const generated = Date.now();
        setSections({ ...final.sections });
        setActiveKey(null);
        setGeneratedAt(generated);
        writeCache(cacheKey, { insights: response, generatedAt: generated });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load insights");
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setLoading(false);
      }
    },
    [cacheKey, portfolioId, portfolioName, tickers],
  );

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void fetchInsights(false));
  }, [open, fetchInsights]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (!open) return null;

  const response = toResponse(sections);
  const allNull =
    !loading &&
    SECTION_KEYS.every((k) => response[k] == null);
  const hasAnyText = SECTION_KEYS.some((k) => sections[k].trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insights-title"
    >
      <button
        type="button"
        aria-label="Close insights"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] dark:bg-slate-950/60"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#0a0e1a]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              AI insights
            </div>
            <h2
              id="insights-title"
              className="mt-0.5 truncate font-mono text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {portfolioName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && !loading && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          )}

          {!error && (loading || hasAnyText) && (
            <div className="flex flex-col gap-3">
              {SECTION_KEYS.map((key) => (
                <SectionCard
                  key={key}
                  sectionKey={key}
                  body={sections[key]}
                  active={loading && activeKey === key}
                  loading={loading}
                />
              ))}
            </div>
          )}

          {!loading && !error && allNull && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
              Nothing notable to flag. Portfolio looks reasonable on the
              signals reviewed.
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            {generatedAt
              ? `Generated ${formatTime(generatedAt)}`
              : loading
                ? "Streaming…"
                : ""}
          </div>
          <button
            type="button"
            onClick={() => void fetchInsights(true)}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
          >
            {loading ? "Generating…" : "Regenerate"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

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

function SectionCard({
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

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
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
