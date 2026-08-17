/** One frame of the assistant's SSE stream. */
export type AssistantEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool"; name: string; status: "running" | "done" }
  | { kind: "done"; conversationId: string; messageId: string }
  | { kind: "error"; message: string };

const FRAME_SEPARATOR = "\n\n";

/**
 * JSON-encode the whole event onto one `data:` line.
 *
 * Model text can contain newlines and can contain the literal `data:`, either
 * of which would corrupt SSE framing if written raw. JSON escaping makes the
 * payload opaque to the framing.
 */
export function encodeEvent(event: AssistantEvent): string {
  return `data: ${JSON.stringify(event)}${FRAME_SEPARATOR}`;
}

/**
 * Stateful decoder. Chunk boundaries fall wherever the network puts them, so a
 * frame can arrive in pieces and several frames can arrive at once — the
 * returned function buffers the remainder between calls.
 */
export function createEventDecoder(): (chunk: string) => AssistantEvent[] {
  let buffer = "";

  return function decode(chunk: string): AssistantEvent[] {
    buffer += chunk;
    const out: AssistantEvent[] = [];

    let idx = buffer.indexOf(FRAME_SEPARATOR);
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + FRAME_SEPARATOR.length);

      const line = frame.startsWith("data: ") ? frame.slice(6) : null;
      if (line !== null) {
        try {
          out.push(JSON.parse(line) as AssistantEvent);
        } catch {
          // A malformed frame is dropped, not thrown: one bad frame must not
          // kill a stream that is still delivering good ones.
        }
      }

      idx = buffer.indexOf(FRAME_SEPARATOR);
    }

    return out;
  };
}
