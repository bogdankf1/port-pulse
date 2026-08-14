import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirects";

const ORIGIN = "https://port-pulse-seven.vercel.app";

/** What the caller actually does with the result. */
function resolve(param: string | null | undefined): URL {
  return new URL(safeNextPath(param), ORIGIN);
}

describe("safeNextPath", () => {
  it("keeps a same-origin path unchanged", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/oauth/consent?authorization_id=abc")).toBe(
      "/oauth/consent?authorization_id=abc",
    );
    expect(safeNextPath("/a/b/c?x=1#y")).toBe("/a/b/c?x=1#y");
  });

  it("defaults to / for empty or missing input", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  // Each of these resolves off-origin if passed straight to new URL().
  it.each([
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com"],
    ["protocol-relative", "//evil.com"],
    ["triple slash", "///evil.com"],
    ["backslash protocol-relative", "/\\evil.com"],
    ["double backslash", "/\\\\evil.com"],
    ["leading backslash", "\\/evil.com"],
    ["non-http scheme", "javascript:alert(1)"],
  ])("rejects %s", (_label, payload) => {
    expect(resolve(payload).origin).toBe(ORIGIN);
  });

  it("never escapes the origin, whatever it is handed", () => {
    const payloads = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "/%2f%2fevil.com",
      "/legit",
      "",
    ];
    for (const p of payloads) {
      expect(resolve(p).origin).toBe(ORIGIN);
    }
  });
});
