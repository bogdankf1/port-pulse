/**
 * Screenshot upload limits, shared by the dropzone and the parse route.
 *
 * In one module because the two copies drifted into a bug: both capped the
 * *raw* file at 10 MB, but Anthropic's per-image ceiling is 10 MB
 * **base64-encoded**, and base64 inflates by 4/3. Anything above roughly
 * 7.5 MB therefore cleared our own check and was rejected upstream, surfacing
 * to the user as an opaque 502 carrying a raw SDK error string.
 */

export const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** What the API actually limits: the size of the encoded payload. */
export const MAX_ENCODED_BYTES = 10 * 1024 * 1024;

/** The largest raw file that still encodes to within `MAX_ENCODED_BYTES`. */
export const MAX_IMAGE_BYTES = Math.floor((MAX_ENCODED_BYTES * 3) / 4);

/** Written out once so the route and the dropzone quote the same number. */
export const MAX_IMAGE_LABEL = "7.5 MB";

/** The same set, shaped for an `<input type="file">` accept attribute. */
export const IMAGE_ACCEPT_ATTR = [...ACCEPTED_IMAGE_TYPES].join(",");
