import type { User } from "@supabase/supabase-js";
import { createEmitter } from "./emitter";
import { createBrowserSupabase, isSupabaseConfigured } from "./supabase";

let user: User | null = null;
let initialized = false;
let initialFetchDone = false;
const store = createEmitter();

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
      store.emit();
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    store.emit();
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
  return store.subscribe(cb);
}

export function isAuthReady(): boolean {
  ensureInit();
  return initialFetchDone;
}

export async function signInWithGoogle(next?: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createBrowserSupabase();
  const callback = `${window.location.origin}/auth/callback`;
  const redirectTo = next
    ? `${callback}?next=${encodeURIComponent(next)}`
    : callback;
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
