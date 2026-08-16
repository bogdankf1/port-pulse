"use client";

import { useSyncExternalStore } from "react";

// Matches Tailwind's `lg` breakpoint.
const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

// Mobile-first: the server renders the small layout, then the client corrects
// on hydration. Both trees are valid HTML, so this is a swap, not a mismatch.
function getServerSnapshot(): boolean {
  return false;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
