import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
