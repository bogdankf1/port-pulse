"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getUser,
  getUserServerSnapshot,
  isAuthReady,
  subscribeUser,
} from "@/lib/auth";
import {
  getActiveIdServerSnapshot,
  getActivePortfolioId,
  getPortfolios,
  getPortfoliosServerSnapshot,
  subscribeActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import { createEventDecoder } from "@/lib/assistant/protocol";
import type { AssistantMessage } from "@/types";
import { ConfirmModal } from "../ConfirmModal";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { SuggestionChips } from "./SuggestionChips";
import { SignInPrompt } from "./SignInPrompt";

export function AssistantView() {
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  // Auth readiness must be its OWN subscribed snapshot, not a plain
  // `isAuthReady()` call during render.
  //
  // `getUser()` returns null both while the initial auth fetch is in flight and
  // when the user is genuinely signed out. Branching on `user` alone therefore
  // flashes the sign-in prompt at every signed-in visitor — the same
  // loading-mistaken-for-empty bug that `isWatchlistLoading()` exists to fix.
  //
  // And reading `isAuthReady()` inline would not work either: for a signed-out
  // user the snapshot is null before and after `lib/auth.ts`'s `emit()`, so
  // `useSyncExternalStore` sees no change and never re-renders — the pane would
  // sit on "loading" forever. `isAuthReady` as its own snapshot flips
  // false → true, which does re-render.
  const authReady = useSyncExternalStore(
    subscribeUser,
    isAuthReady,
    () => false,
  );
  const portfolios = useSyncExternalStore(
    subscribePortfolios,
    getPortfolios,
    getPortfoliosServerSnapshot,
  );
  const activeId = useSyncExternalStore(
    subscribeActivePortfolio,
    getActivePortfolioId,
    getActiveIdServerSnapshot,
  );

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Starts true: for a signed-in user a restore is always about to run, and
  // defaulting to false would show the empty state for one frame before the
  // saved transcript lands.
  const [restoring, setRestoring] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const listRes = await fetch("/api/assistant/conversations");
        if (!listRes.ok) return;
        const { conversations } = (await listRes.json()) as {
          conversations: { id: string }[];
        };
        const latest = conversations[0];
        if (!latest || cancelled) return;
        const msgRes = await fetch(
          `/api/assistant/conversations?id=${encodeURIComponent(latest.id)}`,
        );
        if (!msgRes.ok || cancelled) return;
        const { messages: loaded } = (await msgRes.json()) as {
          messages: AssistantMessage[];
        };
        if (cancelled) return;
        conversationId.current = latest.id;
        setMessages(loaded);
      } catch {
        // A failed restore leaves an empty chat, which is usable.
      } finally {
        // In an async callback, so this never fires synchronously in the
        // effect body. `cancelled` guards the unmount/user-change race.
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const activePortfolioName =
    portfolios.find((p) => p.id === activeId)?.name ?? null;

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setStreaming("");
      // The old suggestions described the previous exchange; leaving them up
      // through the next answer would invite a tap on a stale question.
      setFollowUps([]);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${prev.length}`,
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
        },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let accumulated = "";

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId: conversationId.current,
            activePortfolioName,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(
            res.status === 401
              ? "Sign in required"
              : `Request failed (${res.status})`,
          );
        }

        const decode = createEventDecoder();
        const reader = res.body.getReader();
        const textDecoder = new TextDecoder();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of decode(
            textDecoder.decode(value, { stream: true }),
          )) {
            if (event.kind === "text") {
              accumulated += event.delta;
              setStreaming(accumulated);
            } else if (event.kind === "tool") {
              setRunningTool(event.status === "running" ? event.name : null);
            } else if (event.kind === "followups") {
              setFollowUps(event.questions);
            } else if (event.kind === "done") {
              conversationId.current = event.conversationId;
            } else if (event.kind === "error") {
              accumulated += (accumulated ? "\n\n" : "") + event.message;
              setStreaming(accumulated);
            }
          }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          accumulated +=
            (accumulated ? "\n\n" : "") +
            (err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            {
              id: `local-a-${prev.length}`,
              role: "assistant",
              content: accumulated,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        setStreaming("");
        setRunningTool(null);
        setBusy(false);
        abortRef.current = null;
      }
    },
    [activePortfolioName],
  );

  const clearConversation = useCallback(async () => {
    const id = conversationId.current;
    // Reset locally first — a conversation that was never persisted (nothing
    // sent yet) has no id, and the user still expects the pane to empty.
    conversationId.current = null;
    setMessages([]);
    setStreaming("");
    setFollowUps([]);
    if (!id) return;
    try {
      await fetch(`/api/assistant/conversations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      // The pane is already empty; a failed delete only means the row survives
      // and would be restored on the next visit.
    }
  }, []);

  // Order matters: readiness first, identity second.
  if (!authReady) {
    return (
      <div
        className="mx-auto w-full max-w-3xl px-4 py-10"
        style={{ height: "calc(100dvh - 3.5rem - 1px - env(safe-area-inset-top))" }}
      >
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }
  if (!user) return <SignInPrompt />;

  const empty = messages.length === 0 && !streaming;

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col"
      // Three things come off the viewport, and all three are load-bearing:
      //
      //   3.5rem  the Navbar's inner `h-14` (Navbar.tsx:18). Kept in rem, not
      //           hardcoded as 56px, so it still tracks the bar when the user
      //           scales text up (WCAG 1.4.4) instead of drifting out of sync.
      //   1px     the Navbar's `border-b`, which sits on the OUTER element
      //           (Navbar.tsx:15) and so adds to its height. Measured: the bar
      //           is 57px, not 56. Omitting this leaves `main` ending 1px past
      //           the fold and the document scrolling by 1px.
      //   inset   the Navbar's own `env(safe-area-inset-top)` (Navbar.tsx:16),
      //           without which the composer lands under the fold on a notched
      //           device in standalone mode.
      //
      // At lg this leaves the root layout's footer one footer-height below the
      // fold. That is the accepted cost of a transcript that scrolls on its own
      // rather than scrolling the document; the footer is `hidden` below lg,
      // which is the width that matters here.
      style={{ height: "calc(100dvh - 3.5rem - 1px - env(safe-area-inset-top))" }}
    >
      {!restoring && !empty && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-800/70">
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Assistant
          </span>
          <button
            type="button"
            onClick={() => setClearOpen(true)}
            disabled={busy}
            className="inline-flex min-h-[30px] items-center rounded-md border border-slate-300 px-2.5 font-mono text-[10px] uppercase tracking-widest text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-100"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {restoring ? (
          <TranscriptSkeleton />
        ) : empty ? (
          <div className="mx-auto max-w-md pt-10">
            <h1 className="font-mono text-sm uppercase tracking-widest text-slate-600 dark:text-slate-400">
              Assistant
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Ask anything about
              {activePortfolioName
                ? ` ${activePortfolioName}`
                : " your portfolios"}
              .
            </p>
            <div className="mt-6">
              <SuggestionChips onPick={(p) => void send(p)} />
            </div>
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              streaming={streaming}
              runningTool={runningTool}
            />
            {!busy && followUps.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Ask next
                </div>
                <SuggestionChips
                  prompts={followUps}
                  onPick={(p) => void send(p)}
                />
              </div>
            )}
          </>
        )}
      </div>
      <Composer
        busy={busy}
        onSend={(m) => void send(m)}
        onStop={() => abortRef.current?.abort()}
      />

      <ConfirmModal
        open={clearOpen}
        title="Clear conversation"
        body="This deletes the whole transcript for good. Your portfolios and holdings are not affected."
        confirmLabel="Clear"
        busyLabel="Clearing…"
        destructive
        onConfirm={async () => {
          await clearConversation();
          setClearOpen(false);
        }}
        onCancel={() => setClearOpen(false)}
      />
    </main>
  );
}

/** Shown while the saved transcript is being fetched, so the starter-prompt
 *  empty state never flashes in front of a conversation that does exist. */
function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Loading conversation">
      <div className="h-9 w-48 animate-pulse self-end rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="flex flex-col gap-2">
        <div className="h-3.5 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3.5 w-11/12 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3.5 w-3/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="h-9 w-36 animate-pulse self-end rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="flex flex-col gap-2">
        <div className="h-3.5 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}
