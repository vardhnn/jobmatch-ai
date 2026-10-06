import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { serializeMatch } from "@/lib/services/job-serializer";

/**
 * GET /api/jobs — matched jobs for the signed-in user.
 *
 * Only jobs the decision engine chose to SHOW are listed by default; hidden
 * jobs stay queryable with ?includeHidden=1 so the user can audit the filter.
 * Paginated with ?limit=&offset= — `total` drives the pager.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q")?.trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    const includeHidden = url.searchParams.get("includeHidden") === "1";
    const minScore = Number(url.searchParams.get("minScore") ?? 0);

    const where = {
      userId: user.id,
      ...(includeHidden ? {} : { decision: "SHOW" }),
      ...(category && category !== "ALL" ? { category } : {}),
      ...(minScore > 0 ? { overall: { gte: minScore } } : {}),
      ...(q
        ? {
            OR: [
              { job: { title: { contains: q } } },
              { job: { company: { contains: q } } },
              { job: { location: { contains: q } } },
            ],
          }
        : {}),
    };

    const [matches, total] = await Promise.all([
      prisma.jobMatch.findMany({
        where,
        include: { job: { include: { sourceRecords: { include: { source: true } } } } },
        orderBy: { overall: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.jobMatch.count({ where }),
    ]);

    return NextResponse.json({
      jobs: matches.map(serializeMatch),
      count: matches.length,
      total,
      offset,
      limit,
      hasMore: offset + matches.length < total,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("jobs error", e);
    return NextResponse.json({ error: "INTERNAL", message: "Could not load jobs." }, { status: 500 });
  }
}
