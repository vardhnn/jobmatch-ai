import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { DEFAULT_ENABLED_KEYS } from "@/lib/sources";

/**
 * GET /api/search/queries — the queries used by the most recent run.
 *
 * Generated queries are a suggestion, not a command: the user can disable one
 * (it stops being searched) or add their own before the next run.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const lastRun = await prisma.searchRun.findFirst({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      include: { queries: { orderBy: { query: "asc" } } },
    });

    return NextResponse.json({
      runId: lastRun?.id ?? null,
      ranAt: lastRun?.startedAt ?? null,
      queries: lastRun?.queries.map((q) => ({
        id: q.id,
        query: q.query,
        type: q.type,
        approved: q.approved,
      })) ?? [],
      defaults: DEFAULT_ENABLED_KEYS,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("queries GET error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not load search queries." },
      { status: 500 },
    );
  }
}

/** PATCH /api/search/queries — enable/disable one generated query. */
export async function PATCH(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  let body: { id?: string; approved?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id || typeof body.approved !== "boolean") {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "`id` and boolean `approved` are required." },
      { status: 400 },
    );
  }

  // Ownership check: the query must belong to one of this user's runs.
  const query = await prisma.searchQuery.findFirst({
    where: { id, run: { userId } },
    select: { id: true },
  });
  if (!query) {
    return NextResponse.json({ error: "NOT_FOUND", message: "No such query." }, { status: 404 });
  }

  await prisma.searchQuery.update({ where: { id }, data: { approved: body.approved } });
  return NextResponse.json({ ok: true, id, approved: body.approved });
}

/** POST /api/search/queries — add a custom query for the next run. */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body.query === "string" ? body.query.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (!text) {
    return NextResponse.json({ error: "INVALID_BODY", message: "Query text is required." }, { status: 400 });
  }

  const lastRun = await prisma.searchRun.findFirst({
    where: { userId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!lastRun) {
    return NextResponse.json(
      { error: "NO_RUN", message: "Run a search first — custom queries attach to a run." },
      { status: 409 },
    );
  }

  const existing = await prisma.searchQuery.findFirst({
    where: { runId: lastRun.id, query: text },
    select: { id: true },
  });
  const saved = existing
    ? await prisma.searchQuery.update({ where: { id: existing.id }, data: { approved: true, type: "CUSTOM" } })
    : await prisma.searchQuery.create({ data: { runId: lastRun.id, query: text, type: "CUSTOM" } });

  return NextResponse.json({ ok: true, id: saved.id, query: saved.query, approved: saved.approved });
}
