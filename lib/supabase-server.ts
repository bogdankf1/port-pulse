import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase is not configured");
  }
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Calling .set() from a Server Component throws; route handlers
            // and server actions are fine.
          }
        }
      },
    },
  });
}

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

export type AuthedContext =
  | { user: User; supabase: ServerSupabase; error: null }
  | { user: null; supabase: null; error: NextResponse };

/**
 * The caller's Supabase client and verified user, or the 401 to return.
 *
 * Every authenticated route opened with some spelling of this — five of them
 * carried a verbatim `isConfigured()` plus `getAuthedSupabase()` pair, and the
 * rest inlined the two calls. The copies had drifted apart in one respect worth
 * naming: without the env check, `createServerSupabase()` *throws* on an
 * unconfigured deployment, so those routes answered 500 where the others
 * answered 401. This returns 401 in both cases.
 *
 * It hands back the response rather than throwing it, so each handler keeps
 * control of **when** it authenticates. That is load-bearing: `/api/assistant`,
 * `/api/compare` and `/api/positions/[symbol]` validate their input first and
 * answer 400 to a malformed request before asking who is making it. Call this
 * where the old code called it, not automatically at the top.
 */
export async function requireUser(): Promise<AuthedContext> {
  const unauthorized = {
    user: null,
    supabase: null,
    error: NextResponse.json({ error: "Sign in required" }, { status: 401 }),
  } as const;

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return unauthorized;
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized;

  return { user, supabase, error: null };
}
