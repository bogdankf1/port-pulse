import { NextResponse } from "next/server";
import { lookupSector } from "@/lib/sectorMap";

const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const MAX_SYMBOLS = 50;

export function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_RE.test(s)),
    ),
  ).slice(0, MAX_SYMBOLS);

  const sectors: Record<string, string | null> = {};
  for (const sym of symbols) sectors[sym] = lookupSector(sym);

  return NextResponse.json({ sectors });
}
