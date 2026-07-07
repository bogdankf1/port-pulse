import type { InsightsResponse, InsightsSectionKey, Ticker } from "@/types";
import { getPriceSync } from "@/lib/finnhub";

export type CachedInsights = {
  insights: InsightsResponse;
  generatedAt: number;
};

export const SESSION_PREFIX = "pp:insights:v2";
export const SECTION_KEYS: InsightsSectionKey[] = [
  "concentration_risk",
  "sector_tilt",
  "winners",
  "losers",
  "suggestion",
];

export function emptySections(): Record<InsightsSectionKey, string> {
  return {
    concentration_risk: "",
    sector_tilt: "",
    winners: "",
    losers: "",
    suggestion: "",
  };
}

export function toResponse(
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

export function hashHoldings(tickers: Ticker[]): string {
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

export function readCache(key: string): CachedInsights | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedInsights;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: CachedInsights) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

// Streaming text parser — split incoming text into per-section buffers based on
// the `<<key>>` markers the model emits. Resilient to chunks arriving mid-marker.
export function makeSectionStream() {
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
