"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
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
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activePortfolioName =
    portfolios.find((p) => p.id === activeId)?.name ?? null;

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setStreaming("");
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

  // Order matters: readiness first, identity second.
  if (!authReady) {
    return (
      <div
        className="mx-auto w-full max-w-3xl px-4 py-10"
        style={{ height: "calc(100dvh - 56px - env(safe-area-inset-top))" }}
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
      // The global Navbar is `h-14` (56px) **plus** its own
      // `env(safe-area-inset-top)` (Navbar.tsx:16), so both must come off —
      // subtracting only 56px puts the composer under the fold on a notched
      // device in standalone mode.
      //
      // At lg this leaves the root layout's footer one footer-height below the
      // fold. That is the accepted cost of a transcript that scrolls on its own
      // rather than scrolling the document; the footer is `hidden` below lg,
      // which is the width that matters here.
      style={{ height: "calc(100dvh - 56px - env(safe-area-inset-top))" }}
    >
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {empty ? (
          <div className="mx-auto max-w-md pt-10">
            <h1 className="font-mono text-sm uppercase tracking-widest text-slate-500">
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
          <MessageList
            messages={messages}
            streaming={streaming}
            runningTool={runningTool}
          />
        )}
      </div>
      <Composer
        busy={busy}
        onSend={(m) => void send(m)}
        onStop={() => abortRef.current?.abort()}
      />
    </main>
  );
}
