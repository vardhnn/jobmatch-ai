import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { testCredential, validateCredential, type AiCredential } from "@/lib/ai/providers";

export const maxDuration = 30;

/**
 * POST /api/ai/test — verify a BYOK credential with one cheap real call.
 *
 * The submitted credential is used in-memory only and never stored or logged.
 * Invalid submissions are rejected with 422 before any network call; provider
 * failures (bad key, quota, timeout) come back as ok:false with the reason.
 */
export async function POST(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  const limit = rateLimit("ai-test", 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many connection tests — wait a minute." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const b = (body ?? {}) as Partial<AiCredential>;
  const credential: AiCredential = {
    provider: b.provider as AiCredential["provider"],
    apiKey: typeof b.apiKey === "string" ? b.apiKey : "",
    model: typeof b.model === "string" ? b.model : "",
    baseUrl: typeof b.baseUrl === "string" && b.baseUrl.trim() ? b.baseUrl.trim() : null,
  };

  const problem = validateCredential(credential);
  if (problem) {
    return NextResponse.json({ error: "INVALID_CREDENTIAL", message: problem }, { status: 422 });
  }

  const result = await testCredential(credential);
  return NextResponse.json(result);
}
