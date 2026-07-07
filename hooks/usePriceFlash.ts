"use client";

import { useEffect, useRef, useState } from "react";

// Green/red flash state machine for a live price. Diffs the incoming price
// against the last seen value and returns a transient CSS class for 600ms.
export function usePriceFlash(price: number | null | undefined): string {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeen = useRef<number | null>(null);

  useEffect(() => {
    if (price == null) return;
    if (lastSeen.current != null && price !== lastSeen.current) {
      const dir = price > lastSeen.current ? "up" : "down";
      setFlash(dir);
      if (flashTimer.current != null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        flashTimer.current = null;
      }, 600);
    }
    lastSeen.current = price;
  }, [price]);

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) clearTimeout(flashTimer.current);
    };
  }, []);

  return flash === "up"
    ? "flash-up-row"
    : flash === "down"
      ? "flash-down-row"
      : "";
}
