"use client";

export type Theme = "light" | "dark";

const KEY = "port-pulse:theme";
const listeners = new Set<() => void>();
let current: Theme = "dark";
let initialized = false;

function readStored(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersLight(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function apply(t: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (t === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = t;
}

function init(): void {
  if (initialized) return;
  initialized = true;
  if (typeof document === "undefined") return;
  // The inline script in <head> already applied the right class. Sync our
  // module state to whatever the DOM is showing so toggling works correctly.
  current = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
  // Persist initial choice if the user has never explicitly picked one.
  if (readStored() === null) {
    try {
      localStorage.setItem(KEY, current);
    } catch {
      // ignore
    }
  }
}

export function getTheme(): Theme {
  init();
  return current;
}

export function getThemeServerSnapshot(): Theme {
  return "dark";
}

export function setTheme(t: Theme): void {
  init();
  if (current === t) return;
  current = t;
  apply(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function toggleTheme(): void {
  init();
  setTheme(current === "dark" ? "light" : "dark");
}

export function subscribeTheme(cb: () => void): () => void {
  init();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export { systemPrefersLight };
