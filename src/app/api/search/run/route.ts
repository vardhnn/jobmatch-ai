import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runSearchForUser } from "@/lib/services/search-service";
import { rateLimit } from "@/lib/rate-limit";
import { parseAiCredential } from "@/lib/ai/credential-header";

export const maxDuration = 300;

/**
 * POST /api/search/run — run the full pipeline now.
 *
 * BYOK: the caller's active AI credential rides in the `X-AI-Credential`
 * header. Without one the run still fetches/stores jobs but skips matching
 * (surfaced in the summary notes).
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  // A search is expensive (network + AI + JEV): one per 60s per user.
  const limit = rateLimit(`search:${userId}`, 1, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "A search just ran — give it a minute." },
      { status: 429 },
    );
  }

  // Absent/malformed header → null → degraded (fetch/store-only) run.
  const credential = parseAiCredential(req);

  try {
    const summary = await runSearchForUser(userId, "MANUAL", credential);
    return NextResponse.json({ summary });
  } catch (e) {
    console.error("search run error", e);
    return NextResponse.json(
      {
        error: "SEARCH_FAILED",
        message: e instanceof Error ? e.message : "Search failed.",
      },
      { status: 500 },
    );
  }
}
