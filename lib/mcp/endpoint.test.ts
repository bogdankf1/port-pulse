import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";
// Pin a non-default origin so the challenge assertion below proves the metadata
// URL is built from config plus one path, rather than from the request URL.
process.env.NEXT_PUBLIC_SITE_URL = "https://port-pulse-seven.vercel.app";

const VALID_TOKEN = "valid-token";

// Only the network-touching edges are stubbed. withMcpAuth, toAuthInfo,
// authContextFrom and the tool itself all run for real, because the wiring
// between them is exactly what this file exists to pin down.
vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      if (token !== VALID_TOKEN) throw new actual.McpAuthError("bad token");
      return {
        userId: "user-123",
        token,
        clientId: "client-abc",
        scopes: ["openid"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    }),
  };
});

const seenUserIds: string[] = [];

vi.mock("./supabase", () => ({
  createUserClient: (ctx: { userId: string }) => {
    seenUserIds.push(ctx.userId);
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { id: "p1", name: "Portfolio", watchlist_items: [{ count: 3 }] },
                ],
                error: null,
              }),
          }),
        }),
      }),
    };
  },
}));

const { POST } = await import("@/app/api/mcp/route");

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "MCP-Protocol-Version": "2025-06-18",
};

async function call(body: unknown, token?: string) {
  const res = await POST(
    new Request("https://port-pulse-seven.vercel.app/api/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  // Streamable HTTP may answer as SSE; unwrap the first data: frame if so.
  const json = text.startsWith("event:") || text.startsWith("data:")
    ? JSON.parse(text.split("data: ")[1]?.split("\n")[0] ?? "{}")
    : text
      ? JSON.parse(text)
      : {};
  return { status: res.status, headers: res.headers, json };
}

const INIT = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

describe("POST /api/mcp", () => {
  beforeEach(() => {
    seenUserIds.length = 0;
  });

  it("challenges an unauthenticated request with a resource_metadata URL", async () => {
    const { status, headers } = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(status).toBe(401);
    const challenge = headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    // A single well-formed absolute URL — not an origin concatenated onto a
    // full URL, which is what passing a URL as resourceMetadataPath produces.
    expect(challenge).toContain(
      'resource_metadata="https://port-pulse-seven.vercel.app/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it("rejects an invalid token with 401", async () => {
    const { status } = await call(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      "wrong-token",
    );
    expect(status).toBe(401);
  });

  it("lists tools for an authenticated caller", async () => {
    await call(INIT, VALID_TOKEN);
    const { status, json } = await call(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      VALID_TOKEN,
    );

    expect(status).toBe(200);
    const names = (json.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toContain("list_portfolios");
  });

  it("passes the verified userId from the token through to the tool", async () => {
    await call(INIT, VALID_TOKEN);
    const { status, json } = await call(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_portfolios", arguments: {} },
      },
      VALID_TOKEN,
    );

    expect(status).toBe(200);
    expect(json.result?.content?.[0]?.text).toContain("Portfolio");
    // The whole point: the id reaching Supabase is the token's sub, and it got
    // there via ctx.http.authInfo rather than any ambient state.
    expect(seenUserIds).toEqual(["user-123"]);
  });
});
