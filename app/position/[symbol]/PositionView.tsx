"use client";

import { PositionHeader } from "@/components/position/PositionHeader";
import { PositionHoldings } from "@/components/position/PositionHoldings";
import { PositionChart } from "@/components/position/PositionChart";

type Props = { symbol: string };

export function PositionView({ symbol }: Props) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 py-4 sm:space-y-5 sm:px-6 sm:py-10">
      <PositionHeader symbol={symbol} />
      <PositionHoldings symbol={symbol} />
      <PositionChart symbol={symbol} />
    </main>
  );
}
