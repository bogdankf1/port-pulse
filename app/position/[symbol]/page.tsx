import { notFound } from "next/navigation";
import { PositionView } from "./PositionView";

type Ctx = { params: Promise<{ symbol: string }> };

const SYMBOL_RE = /^[A-Z]{1,10}(\.[A-Z]{1,3})?$/;

export default async function PositionPage({ params }: Ctx) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw || "").trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    notFound();
  }
  return <PositionView symbol={symbol} />;
}

export async function generateMetadata({ params }: Ctx) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw || "").trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) return { title: "Position" };
  return { title: `${symbol} — Port Pulse` };
}
