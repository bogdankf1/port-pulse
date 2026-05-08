"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Uploader } from "@/components/Uploader";
import {
  getWatchlist,
  getWatchlistServerSnapshot,
  subscribeWatchlist,
} from "@/lib/storage";

export default function Home() {
  const router = useRouter();
  const tickers = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlist,
    getWatchlistServerSnapshot,
  );

  useEffect(() => {
    if (tickers.length > 0) {
      router.replace("/dashboard");
    }
  }, [tickers.length, router]);

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="mb-10 text-center">
        <h1 className="font-mono text-4xl font-bold tracking-tight text-slate-100 sm:text-5xl">
          Port Pulse
        </h1>
        <p className="mt-3 max-w-md text-sm text-slate-400 sm:text-base">
          Drop a screenshot of your brokerage portfolio. Watch the prices come
          alive.
        </p>
      </div>
      <Uploader />
      <div className="mt-8 font-mono text-[11px] uppercase tracking-widest text-slate-700">
        Claude Vision · Finnhub live data
      </div>
    </main>
  );
}
