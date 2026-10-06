import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runSearchForUser } from "@/lib/services/search-service";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 300;

/** POST /api/search/run — run the full pipeline now. */
export async function POST() {
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

  try {
    const summary = await runSearchForUser(userId, "MANUAL");
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
