import { describe, expect, it, vi } from "vitest";

// `./persist` imports the `server-only` marker package, which throws
// unconditionally unless resolved via Next.js's bundler (which aliases it to
// a no-op through the "react-server" export condition). Vitest runs under
// plain Node resolution, so stub it out here, matching lib/mcp/auth.test.ts
// and lib/assistant/tools.test.ts.
vi.mock("server-only", () => ({}));

const { deriveTitle, MAX_TITLE_LENGTH } = await import("./persist");

describe("deriveTitle", () => {
  it("uses the first message as-is when it is short", () => {
    expect(deriveTitle("What are my biggest risks?")).toBe(
      "What are my biggest risks?",
    );
  });

  it("collapses whitespace and newlines", () => {
    expect(deriveTitle("  how   diversified\nam I?  ")).toBe(
      "how diversified am I?",
    );
  });

  it("truncates long messages on a word boundary with an ellipsis", () => {
    const long =
      "Tell me everything about how concentrated this portfolio is and whether " +
      "I should be worried about the overlap between my index funds";
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
    // No mid-word cut.
    expect(title.slice(0, -1).trimEnd()).toBe(title.slice(0, -1));
  });

  it("falls back for an empty or whitespace-only message", () => {
    expect(deriveTitle("")).toBe("New conversation");
    expect(deriveTitle("   \n  ")).toBe("New conversation");
  });

  it("handles a single word longer than the limit", () => {
    const title = deriveTitle("A".repeat(200));
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
  });
});
