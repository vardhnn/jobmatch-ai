import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";

/** GET /api/notifications — newest first, optionally only unread. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unread") === "1";

    const [notifications, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id, ...(unreadOnly ? { read: false } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        kind: n.kind,
        read: n.read,
        createdAt: n.createdAt,
      })),
      unread,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("notifications error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not load notifications." },
      { status: 500 },
    );
  }
}

/** PATCH /api/notifications — mark everything read. */
export async function PATCH() {
  try {
    const user = await requireUser();
    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("notifications PATCH error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not update notifications." },
      { status: 500 },
    );
  }
}
