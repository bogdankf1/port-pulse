/**
 * Constrain a user-supplied post-auth redirect target to a same-origin path.
 *
 * `new URL(next, origin)` silently ignores its base whenever `next` parses as
 * absolute, so an unchecked value turns any redirect into an open redirect.
 *
 * Rejecting `//host` is not enough: WHATWG URL parsing treats a backslash as a
 * path separator for special schemes, so `/\host` is protocol-relative exactly
 * like `//host` and escapes the origin too. The guard therefore requires a
 * leading `/` that is *not* followed by another `/` or a `\`.
 */
export function safeNextPath(param: string | null | undefined): string {
  const next = param || "/";
  return /^\/(?![/\\])/.test(next) ? next : "/";
}
