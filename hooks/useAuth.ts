"use client";

import { useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import {
  getUser,
  getUserServerSnapshot,
  isAuthReady,
  subscribeUser,
} from "@/lib/auth";

export type AuthState = {
  /**
   * Null both while the initial auth fetch is in flight and when the visitor is
   * genuinely signed out — `ready` is what tells those apart.
   */
  user: User | null;
  /** True once `lib/auth.ts` has resolved its first `getUser()`. */
  ready: boolean;
};

const NOT_READY_ON_SERVER = () => false;

/**
 * The signed-in user and whether auth has finished resolving.
 *
 * **Read `ready` before branching on `user`.** `getUser()` returns null in two
 * different situations, and treating them the same is a bug this codebase has
 * now hit twice: branching on `user` alone flashes a sign-in prompt at every
 * signed-in visitor (the loading-mistaken-for-empty shape that
 * `isWatchlistLoading()` also exists to fix), and IDEAS #18 was the inverse —
 * a fetch effect that bailed on a readiness check it never re-ran.
 *
 * Readiness is a **subscribed snapshot**, not a plain `isAuthReady()` call
 * during render, and that is the part worth stating because it is not obvious:
 * `onAuthStateChange` emits the user on INITIAL_SESSION while `initialFetchDone`
 * is still false, so for a signed-out visitor the `user` snapshot is null both
 * before and after `emit()`. `useSyncExternalStore` sees no change and never
 * re-renders, so an inline read would sit on its loading branch forever.
 * `isAuthReady` as its own snapshot flips false → true, which does re-render.
 *
 * Two `useSyncExternalStore` calls rather than one returning `{ user, ready }`:
 * the snapshot is compared by identity, so a fresh object per call would
 * re-render without end. Building that object here, after both snapshots have
 * settled, is free.
 */
export function useAuth(): AuthState {
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  const ready = useSyncExternalStore(
    subscribeUser,
    isAuthReady,
    NOT_READY_ON_SERVER,
  );
  return { user, ready };
}
