import { describe, expect, it } from "vitest";
import {
  createEventDecoder,
  encodeEvent,
  type AssistantEvent,
} from "./protocol";

function roundTrip(events: AssistantEvent[]): AssistantEvent[] {
  const decode = createEventDecoder();
  return events.flatMap((e) => decode(encodeEvent(e)));
}

describe("encodeEvent / createEventDecoder", () => {
  it("round-trips every event kind", () => {
    const events: AssistantEvent[] = [
      { kind: "text", delta: "Hello" },
      { kind: "tool", name: "get_risk_metrics", status: "running" },
      { kind: "tool", name: "get_risk_metrics", status: "done" },
      { kind: "done", conversationId: "c1", messageId: "m1" },
      { kind: "error", message: "upstream failed" },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("survives a delta containing newlines", () => {
    const e: AssistantEvent = { kind: "text", delta: "line one\nline two\n\n" };
    expect(roundTrip([e])).toEqual([e]);
  });

  it("survives a delta that looks like SSE framing", () => {
    const e: AssistantEvent = { kind: "text", delta: "data: not an event\n\n" };
    expect(roundTrip([e])).toEqual([e]);
  });

  it("reassembles a frame split across chunks", () => {
    const wire = encodeEvent({ kind: "text", delta: "split me" });
    const cut = Math.floor(wire.length / 2);
    const decode = createEventDecoder();
    expect(decode(wire.slice(0, cut))).toEqual([]);
    expect(decode(wire.slice(cut))).toEqual([{ kind: "text", delta: "split me" }]);
  });

  it("decodes several frames arriving in one chunk", () => {
    const wire =
      encodeEvent({ kind: "text", delta: "a" }) +
      encodeEvent({ kind: "text", delta: "b" });
    expect(createEventDecoder()(wire)).toEqual([
      { kind: "text", delta: "a" },
      { kind: "text", delta: "b" },
    ]);
  });

  it("ignores a malformed frame rather than throwing", () => {
    const decode = createEventDecoder();
    expect(decode("data: {not json}\n\n")).toEqual([]);
    // and keeps working afterwards
    expect(decode(encodeEvent({ kind: "text", delta: "ok" }))).toEqual([
      { kind: "text", delta: "ok" },
    ]);
  });

  it("holds an incomplete trailing frame until it completes", () => {
    const decode = createEventDecoder();
    expect(decode('data: {"kind":"text","delta":"pending"}')).toEqual([]);
    expect(decode("\n\n")).toEqual([{ kind: "text", delta: "pending" }]);
  });
});
