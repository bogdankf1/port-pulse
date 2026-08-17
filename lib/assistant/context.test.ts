import { describe, expect, it } from "vitest";
import { mcpContextFromSession } from "./context";

describe("mcpContextFromSession", () => {
  it("carries the user id and uses the access token as the bearer", () => {
    const ctx = mcpContextFromSession("user-123", "eyJhbGciOi.token.sig");
    expect(ctx.userId).toBe("user-123");
    // createUserClient sends this as `Authorization: Bearer ${ctx.token}`
    // against the anon key, which is what keeps RLS applying as this user.
    expect(ctx.token).toBe("eyJhbGciOi.token.sig");
  });

  it("fills the OAuth-only fields with inert values", () => {
    const ctx = mcpContextFromSession("user-123", "tok");
    expect(ctx.clientId).toBe("port-pulse-app");
    expect(ctx.scopes).toEqual([]);
  });

  it("does not invent an expiry", () => {
    // The cookie session's own refresh handles expiry; a fabricated `exp`
    // here would be a lie that some future caller might trust.
    expect(mcpContextFromSession("u", "t").expiresAt).toBeUndefined();
  });
});
