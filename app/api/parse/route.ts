import { NextResponse } from "next/server";
import { parseScreenshot } from "@/lib/claude";

export const runtime = "nodejs";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
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
  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported image format. Use PNG, JPEG, or WebP." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image exceeds 10 MB" },
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
