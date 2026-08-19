"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { parseMarkdown, type Align, type Block, type Inline } from "@/lib/markdown";
import { useCompanyProfile } from "@/lib/profile";
import {
  getWatchlist,
  getWatchlistServerSnapshot,
  subscribeWatchlist,
} from "@/lib/storage";
import {
  getPortfolios,
  getPortfoliosServerSnapshot,
  setActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import type { Portfolio } from "@/types";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Entities = {
  source: string | null;
  symbols: Set<string>;
  portfolios: Map<string, Portfolio>;
};

/**
 * The set of names worth turning into links.
 *
 * Deliberately closed rather than pattern-based: matching anything
 * ticker-shaped would link USD, ETF, AI and P&L on every other line. Only
 * symbols the user actually holds and portfolios they actually own qualify, so
 * a link is always somewhere real to go.
 */
function useEntities(): Entities {
  const tickers = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlist,
    getWatchlistServerSnapshot,
  );
  const portfolios = useSyncExternalStore(
    subscribePortfolios,
    getPortfolios,
    getPortfoliosServerSnapshot,
  );

  return useMemo(() => {
    const symbols = new Set(tickers.map((t) => t.symbol));
    const byName = new Map(portfolios.map((p) => [p.name, p] as const));
    const names = [...symbols, ...byName.keys()]
      // Longest first, so a portfolio named "Growth Tech" wins over "Growth".
      .sort((a, b) => b.length - a.length)
      .map(escapeRe);
    return {
      source: names.length ? `\\b(?:${names.join("|")})\\b` : null,
      symbols,
      portfolios: byName,
    };
  }, [tickers, portfolios]);
}

function TickerChip({ symbol }: { symbol: string }) {
  const profile = useCompanyProfile(symbol);
  return (
    <Link
      href={`/position/${encodeURIComponent(symbol)}`}
      title={profile.name ? `${symbol} — ${profile.name}` : `Open ${symbol}`}
      className="inline-flex translate-y-px items-center gap-1 rounded border border-slate-300 bg-slate-100/80 px-1 font-mono text-[0.85em] font-semibold text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-200/80 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:border-slate-500"
    >
      {profile.logo && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={profile.logo}
          alt=""
          className="h-3 w-3 shrink-0 rounded-[2px] bg-white object-contain"
          loading="lazy"
        />
      )}
      {symbol}
    </Link>
  );
}

function PortfolioLink({ portfolio }: { portfolio: Portfolio }) {
  const router = useRouter();
  return (
    <button
      type="button"
      title={`Open ${portfolio.name}`}
      onClick={() => {
        setActivePortfolio(portfolio.id);
        router.push("/");
      }}
      className="rounded font-medium text-slate-900 underline decoration-slate-400 decoration-dotted underline-offset-2 transition-colors hover:decoration-slate-900 dark:text-slate-100 dark:decoration-slate-500 dark:hover:decoration-slate-100"
    >
      {portfolio.name}
    </button>
  );
}

/** Splits a run of plain text on known tickers and portfolio names. */
function LinkedText({ value, entities }: { value: string; entities: Entities }) {
  if (!entities.source) return <>{value}</>;

  // Fresh instance per call: a shared global regex carries `lastIndex` between
  // renders, which would silently skip matches in later messages.
  const re = new RegExp(entities.source, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(value)) !== null) {
    if (match.index > last) out.push(value.slice(last, match.index));
    const hit = match[0];
    const portfolio = entities.portfolios.get(hit);
    if (entities.symbols.has(hit)) {
      out.push(<TickerChip key={key++} symbol={hit} />);
    } else if (portfolio) {
      out.push(<PortfolioLink key={key++} portfolio={portfolio} />);
    } else {
      out.push(hit);
    }
    last = match.index + hit.length;
  }

  if (last === 0) return <>{value}</>;
  if (last < value.length) out.push(value.slice(last));
  return <>{out}</>;
}

function Inlines({
  nodes,
  entities,
}: {
  nodes: Inline[];
  entities: Entities;
}): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <LinkedText key={i} value={node.value} entities={entities} />;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-slate-900 dark:text-slate-100">
            <Inlines nodes={node.children} entities={entities} />
          </strong>
        );
      case "em":
        return (
          <em key={i} className="italic">
            <Inlines nodes={node.children} entities={entities} />
          </em>
        );
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-slate-100 px-1 py-px font-mono text-[0.85em] text-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            {node.value}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target={node.href.startsWith("/") ? undefined : "_blank"}
            rel={node.href.startsWith("/") ? undefined : "noopener noreferrer"}
            className="underline decoration-slate-400 underline-offset-2 hover:decoration-slate-900 dark:hover:decoration-slate-100"
          >
            <Inlines nodes={node.children} entities={entities} />
          </a>
        );
    }
  });
}

const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function BlockView({ block, entities }: { block: Block; entities: Entities }) {
  switch (block.type) {
    case "heading": {
      const size =
        block.level === 1
          ? "text-[15px]"
          : block.level === 2
            ? "text-sm"
            : "text-[13px]";
      return (
        <h2
          className={`font-mono ${size} font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400`}
        >
          <Inlines nodes={block.children} entities={entities} />
        </h2>
      );
    }

    case "paragraph":
      return (
        <p className="leading-relaxed">
          <Inlines nodes={block.children} entities={entities} />
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`ml-4 flex list-outside flex-col gap-1 leading-relaxed ${
            block.ordered ? "list-decimal" : "list-disc"
          } marker:text-slate-400 dark:marker:text-slate-600`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              <Inlines nodes={item} entities={entities} />
            </li>
          ))}
        </Tag>
      );
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <code className="font-mono text-[12px] leading-relaxed text-slate-800 dark:text-slate-200">
            {block.value}
          </code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <Inlines nodes={block.children} entities={entities} />
        </blockquote>
      );

    case "rule":
      return <hr className="border-slate-200 dark:border-slate-800" />;

    case "table":
      return (
        // Table markup and header treatment mirror PortfolioTable, so a table
        // the assistant writes reads as the same object as the dashboard's.
        <div className="-mx-1 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:bg-slate-900/60">
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className={`border-y border-slate-200 px-2.5 py-2 font-medium dark:border-slate-800/70 ${
                      ALIGN_CLASS[block.align[i] ?? "left"]
                    }`}
                  >
                    <Inlines nodes={cell} entities={entities} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={`border-b border-slate-100 px-2.5 py-2 tabular-nums dark:border-slate-800/70 ${
                        ALIGN_CLASS[block.align[c] ?? "left"]
                      }`}
                    >
                      <Inlines nodes={cell} entities={entities} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ content }: { content: string }) {
  const entities = useEntities();
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="flex flex-col gap-3 text-sm text-slate-800 dark:text-slate-200">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} entities={entities} />
      ))}
    </div>
  );
}
