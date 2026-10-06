import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { describeSources } from "@/lib/services/search-service";
import { getAdapter } from "@/lib/sources";

/** GET /api/sources — every adapter with live status for this account. */
export async function GET() {
  try {
    const user = await requireUser();
    const sources = await describeSources(user.id);
    return NextResponse.json({ sources });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("sources GET error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not load sources." },
      { status: 500 },
    );
  }
}

/** PATCH /api/sources — enable or disable one source. */
export async function PATCH(req: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  let body: { key?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  const adapter = getAdapter(key);
  if (!adapter) {
    return NextResponse.json({ error: "UNKNOWN_SOURCE", message: `No source "${key}".` }, { status: 404 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "`enabled` must be true or false." },
      { status: 400 },
    );
  }
  if (body.enabled && !adapter.isConfigured()) {
    return NextResponse.json(
      { error: "NOT_CONFIGURED", message: adapter.configureHint },
      { status: 422 },
    );
  }

  const configured = adapter.isConfigured();
  await prisma.jobSource.upsert({
    where: { userId_key: { userId, key } },
    update: {
      enabled: body.enabled,
      status: configured ? (body.enabled ? "CONNECTED" : "READY") : "NOT_CONFIGURED",
      statusDetail: configured ? "Ready" : adapter.configureHint,
    },
    create: {
      userId,
      key,
      enabled: body.enabled,
      status: configured ? "CONNECTED" : "NOT_CONFIGURED",
      statusDetail: configured ? "Ready" : adapter.configureHint,
      config: "{}",
    },
  });

  const sources = await describeSources(userId);
  return NextResponse.json({ sources });
}
