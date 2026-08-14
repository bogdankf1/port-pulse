"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { signInWithGoogle } from "@/lib/auth";

type Details = {
  authorization_id: string;
  redirect_uri: string;
  client: { name: string; logo_uri: string };
  user: { id: string; email: string };
  scope: string;
};

export default function ConsentPage() {
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(
      "authorization_id",
    );
    if (!id) {
      queueMicrotask(() =>
        setError("Missing authorization_id. Start the connection from Claude."),
      );
      return;
    }
    queueMicrotask(() => setAuthorizationId(id));

    if (!isSupabaseConfigured()) {
      queueMicrotask(() => setError("Supabase is not configured."));
      return;
    }

    const supabase = createBrowserSupabase();

    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          // Come back here after Google sign-in, or the pending authorization
          // request is lost.
          await signInWithGoogle(`/oauth/consent?authorization_id=${id}`);
          return;
        }

        const { data, error: err } =
          await supabase.auth.oauth.getAuthorizationDetails(id);
        if (err) {
          setError(err.message);
          return;
        }
        if (data && "authorization_id" in data) {
          setDetails(data as Details);
        } else if (data) {
          // Already consented to these scopes — Supabase auto-approved.
          window.location.href = data.redirect_url;
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load request");
      }
    })();
  }, []);

  const decide = useCallback(
    async (approve: boolean) => {
      if (!authorizationId) return;
      setBusy(true);
      const supabase = createBrowserSupabase();
      // skipBrowserRedirect defaults to false, which would redirect for us.
      // Opt out so the redirect is explicit here rather than a library default.
      const opts = { skipBrowserRedirect: true };
      const { data, error: err } = approve
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, opts)
        : await supabase.auth.oauth.denyAuthorization(authorizationId, opts);
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      if (data?.redirect_url) window.location.href = data.redirect_url;
      else setError("No redirect returned by Supabase.");
    },
    [authorizationId],
  );

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <p className="font-mono text-sm text-red-400">{error}</p>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <p className="font-mono text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Connect {details.client.name}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          It will be able to read your portfolios and holdings. It cannot change
          or delete anything.
        </p>
      </div>

      <dl className="space-y-2 rounded-lg border border-neutral-800 p-4 font-mono text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">Signed in as</dt>
          <dd className="truncate text-neutral-300">{details.user.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">Redirects to</dt>
          <dd className="truncate text-neutral-300">{details.redirect_uri}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">Scopes</dt>
          <dd className="text-neutral-300">
            {details.scope.split(" ").filter(Boolean).join(", ") || "—"}
          </dd>
        </div>
      </dl>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="flex-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="flex-1 rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
