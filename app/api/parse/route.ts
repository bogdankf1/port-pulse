import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { parseScreenshot } from "@/lib/claude";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
} from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  // Sign-in required, matching /api/assistant and /api/balances/parse. This
  // route bills a vision call to our own Anthropic key on every request, and
  // the dropzone fans out over up to ten files at once, so leaving it open let
  // anyone who found the URL spend the account's budget.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing image file" },
      { status: 400 },
    );
  }
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported image format. Use PNG, JPEG, or WebP." },
      { status: 400 },
    );
  }
  // Measured against the raw-byte cap that survives base64 expansion — see
  // lib/upload.ts. Checking 10 MB here would pass files the API then rejects.
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image exceeds ${MAX_IMAGE_LABEL}` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  try {
    const tickers = await parseScreenshot(base64, file.type);
    return NextResponse.json({ tickers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
