"use client";

import dynamic from "next/dynamic";

const WatchlistDashboard = dynamic(
  () =>
    import("@/components/WatchlistDashboard").then(
      (m) => m.WatchlistDashboard,
    ),
  { ssr: false },
);

export default function DashboardPage() {
  return <WatchlistDashboard />;
}
