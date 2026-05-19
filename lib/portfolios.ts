import type { Portfolio } from "@/types";
import { getUser, isAuthReady, subscribeUser } from "./auth";
import { isSupabaseConfigured } from "./supabase";

type Listener = () => void;

const subscribers = new Set<Listener>();
const activeSubscribers = new Set<Listener>();

const EMPTY: Portfolio[] = [];

let portfolios: Portfolio[] = [];
let activeId: string | null = null;
let loading = false;
let initialized = false;
let lastUserId: string | null = null;
let loadSeq = 0;

function emit() {
  for (const cb of subscribers) cb();
}

function emitActive() {
  for (const cb of activeSubscribers) cb();
}

function setState(next: {
  portfolios?: Portfolio[];
  activeId?: string | null;
  loading?: boolean;
}) {
  let activeChanged = false;
  if (next.portfolios !== undefined) portfolios = next.portfolios;
  if (next.activeId !== undefined && next.activeId !== activeId) {
    activeId = next.activeId;
    activeChanged = true;
  }
  if (next.loading !== undefined) loading = next.loading;
  emit();
  if (activeChanged) emitActive();
}

async function loadList(): Promise<Portfolio[] | null> {
  try {
    const res = await fetch("/api/portfolios", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.portfolios)) return null;
    return json.portfolios as Portfolio[];
  } catch {
    return null;
  }
}

async function onAuthChange(): Promise<void> {
  const u = getUser();
  const newId = u?.id ?? null;
  if (newId === lastUserId) return;
  lastUserId = newId;

  if (newId === null) {
    setState({ portfolios: [], activeId: null, loading: false });
    return;
  }

  const seq = ++loadSeq;
  setState({ loading: true });
  const list = await loadList();
  if (seq !== loadSeq) return; // newer load superseded us
  if (!list) {
    setState({ portfolios: [], activeId: null, loading: false });
    return;
  }
  setState({
    portfolios: list,
    activeId: list[0]?.id ?? null,
    loading: false,
  });
}

function ensureInit() {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  if (isSupabaseConfigured()) {
    subscribeUser(() => {
      onAuthChange().catch(() => {});
    });
    if (isAuthReady()) {
      onAuthChange().catch(() => {});
    }
  }
}

export function getPortfolios(): Portfolio[] {
  ensureInit();
  return portfolios;
}

export function getActivePortfolioId(): string | null {
  ensureInit();
  return activeId;
}

export function isPortfoliosLoading(): boolean {
  ensureInit();
  return loading;
}

export function subscribePortfolios(cb: Listener): () => void {
  ensureInit();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function subscribeActivePortfolio(cb: Listener): () => void {
  ensureInit();
  activeSubscribers.add(cb);
  return () => {
    activeSubscribers.delete(cb);
  };
}

export function getPortfoliosServerSnapshot(): Portfolio[] {
  return EMPTY;
}

export function getActiveIdServerSnapshot(): string | null {
  return null;
}

export function setActivePortfolio(id: string): void {
  ensureInit();
  if (!portfolios.some((p) => p.id === id)) return;
  setState({ activeId: id });
}

export async function createPortfolio(name?: string): Promise<Portfolio | null> {
  ensureInit();
  if (!lastUserId) return null;
  try {
    const res = await fetch("/api/portfolios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name ?? "" }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const created = json?.portfolio as Portfolio | undefined;
    if (!created) return null;
    setState({
      portfolios: [...portfolios, created],
      activeId: created.id,
    });
    return created;
  } catch {
    return null;
  }
}

export async function renamePortfolio(
  id: string,
  name: string,
): Promise<boolean> {
  ensureInit();
  if (!lastUserId) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  // Optimistic update
  const prev = portfolios;
  setState({
    portfolios: portfolios.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  });
  try {
    const res = await fetch(`/api/portfolios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      setState({ portfolios: prev });
      return false;
    }
    return true;
  } catch {
    setState({ portfolios: prev });
    return false;
  }
}

export async function deletePortfolio(id: string): Promise<boolean> {
  ensureInit();
  if (!lastUserId) return false;
  if (portfolios.length <= 1) return false;
  const prevList = portfolios;
  const prevActive = activeId;
  const remaining = portfolios.filter((p) => p.id !== id);

  let nextActive = activeId;
  if (activeId === id) {
    nextActive = remaining[0]?.id ?? null;
  }
  setState({ portfolios: remaining, activeId: nextActive });

  try {
    const res = await fetch(`/api/portfolios/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setState({ portfolios: prevList, activeId: prevActive });
      return false;
    }
  } catch {
    setState({ portfolios: prevList, activeId: prevActive });
    return false;
  }
  return true;
}
