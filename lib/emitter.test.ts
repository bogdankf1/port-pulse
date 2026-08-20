import { describe, expect, it, vi } from "vitest";
import { createEmitter } from "./emitter";

describe("createEmitter", () => {
  it("calls every subscriber on emit", () => {
    const e = createEmitter();
    const a = vi.fn();
    const b = vi.fn();
    e.subscribe(a);
    e.subscribe(b);
    e.emit();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("emits to nobody without throwing", () => {
    expect(() => createEmitter().emit()).not.toThrow();
  });

  it("stops calling a subscriber once it unsubscribes", () => {
    const e = createEmitter();
    const cb = vi.fn();
    const off = e.subscribe(cb);
    e.emit();
    off();
    e.emit();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(e.size).toBe(0);
  });

  it("survives the same unsubscribe being called twice", () => {
    const e = createEmitter();
    const off = e.subscribe(() => {});
    off();
    expect(() => off()).not.toThrow();
    expect(e.size).toBe(0);
  });

  it("keeps each registration distinct so one remover frees only its own", () => {
    const e = createEmitter();
    const off1 = e.subscribe(() => {});
    e.subscribe(() => {});
    off1();
    expect(e.size).toBe(1);
  });

  // The behaviour every hand-rolled copy already had: a subscriber that removes
  // itself mid-notification is skipped, not called after removal.
  it("skips a subscriber that unsubscribes during the emit", () => {
    const e = createEmitter();
    const later = vi.fn();
    let offLater = () => {};
    e.subscribe(() => offLater());
    offLater = e.subscribe(later);
    e.emit();
    expect(later).not.toHaveBeenCalled();
  });
});
