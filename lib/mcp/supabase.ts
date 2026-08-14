import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";
import type { McpAuthContext } from "./auth";

/**
 * A client carrying the caller's own token, so existing RLS policies are the
 * single enforcement point. Verified 2026-08-14 (spec Open Question 2): a token
 * minted by the Supabase OAuth server resolves `auth.uid()` in PostgREST exactly
 * like a normal session token, so `auth.uid() = user_id` does the work.
 *
 * Tools still pass an explicit `.eq("user_id", …)` as defence in depth.
 */
export function createUserClient(ctx: McpAuthContext): SupabaseClient {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");

  return createClient(SUPABASE_URL, anon, {
    global: { headers: { Authorization: `Bearer ${ctx.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
