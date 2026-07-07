"use client";

import { useEffect, useRef } from "react";

// Outside-click + Escape-to-close for a popover/menu. Returns a ref to attach
// to the wrapper element; clicks outside it (or Escape) call setOpen(false).
export function useDismissable<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, setOpen]);
  return ref;
}
