import type { User } from "@supabase/supabase-js";
import { createBrowserSupabase, isSupabaseConfigured } from "./supabase";

let user: User | null = null;
let initialized = false;
let initialFetchDone = false;
const subscribers = new Set<() => void>();

function emit(): void {
  for (const sub of subscribers) sub();
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  if (!isSupabaseConfigured()) {
    initialFetchDone = true;
    return;
  }

  const supabase = createBrowserSupabase();
  supabase.auth
    .getUser()
    .then(({ data }) => {
      user = data.user;
    })
    .catch(() => {
      user = null;
    })
    .finally(() => {
      initialFetchDone = true;
      emit();
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    emit();
  });
}

export function getUser(): User | null {
  ensureInit();
  return user;
}

export function getUserServerSnapshot(): User | null {
  return null;
}

export function subscribeUser(cb: () => void): () => void {
  ensureInit();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function isAuthReady(): boolean {
  ensureInit();
  return initialFetchDone;
}

export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createBrowserSupabase();
  const redirectTo = `${window.location.origin}/auth/callback`;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createBrowserSupabase();
  await supabase.auth.signOut();
}
