import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_ACCEPT_ATTR,
  MAX_ENCODED_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
} from "./upload";

/** Bytes a base64 encoding of `raw` bytes occupies, padding included. */
function encodedSize(raw: number): number {
  return Math.ceil(raw / 3) * 4;
}

describe("upload limits", () => {
  // The regression: a 10 MB raw cap encodes to ~13.3 MB and is rejected by the
  // API, so files between the two ceilings failed after the upload finished.
  it("keeps the largest accepted file within the API's encoded ceiling", () => {
    expect(encodedSize(MAX_IMAGE_BYTES)).toBeLessThanOrEqual(MAX_ENCODED_BYTES);
  });

  it("would have rejected the old 10 MB raw cap", () => {
    expect(encodedSize(10 * 1024 * 1024)).toBeGreaterThan(MAX_ENCODED_BYTES);
  });

  it("leaves no usable headroom below the cap", () => {
    expect(encodedSize(MAX_IMAGE_BYTES + 3)).toBeGreaterThan(MAX_ENCODED_BYTES);
  });

  it("quotes a label matching the byte cap", () => {
    expect(MAX_IMAGE_LABEL).toBe(
      `${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(1)} MB`,
    );
  });

  it("shapes the same set for the file input", () => {
    expect(IMAGE_ACCEPT_ATTR).toBe("image/png,image/jpeg,image/webp");
  });

  it("accepts the formats Claude vision supports", () => {
    expect([...ACCEPTED_IMAGE_TYPES].sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});
