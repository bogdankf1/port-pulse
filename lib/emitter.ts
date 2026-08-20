/**
 * The subscriber set every module store in `lib/` keeps, and the two things
 * they all do with it.
 *
 * Six stores — auth, storage, portfolios, theme, dailyClose, finnhub — each
 * hand-rolled the same `Set`, the same `for (const cb of set) cb()`, and the
 * same add-then-return-a-remover. That plumbing is all this extracts. The state
 * those stores guard is deliberately left where it is: `storage`'s
 * `migrating`/`fetchSeq`/`loadedKey` race guards and `finnhub`'s socket
 * lifecycle are the reason those files look different from each other, and
 * generalising them would trade hard-won fixes for symmetry.
 */
export type Emitter = {
  /** Notify every subscriber. A no-op when there are none. */
  emit: () => void;
  /** Register `cb`. The returned function removes it, and is idempotent. */
  subscribe: (cb: () => void) => () => void;
  /** Live subscriber count. Exists so the unsubscribe contract is testable. */
  readonly size: number;
};

export function createEmitter(): Emitter {
  const subscribers = new Set<() => void>();

  return {
    // Iterating the Set directly, not a copy: a subscriber that unsubscribes
    // during a notification is then skipped rather than called after removal,
    // which is the behaviour every hand-rolled copy of this already had.
    emit: () => {
      for (const cb of subscribers) cb();
    },
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    get size() {
      return subscribers.size;
    },
  };
}
