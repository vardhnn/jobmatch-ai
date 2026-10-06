import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { ensureDefaultSources } from "@/lib/services/search-service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Account registration. Rules:
 *  - Always allowed while zero users exist (first-run bootstrap).
 *  - Afterwards, only in development mode (personal V1; production would
 *    gate this behind invitations).
 */
export async function POST(req: Request) {
  const rl = rateLimit(rateLimitKey(req, "register"), 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many attempts. Try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password, name } = (body ?? {}) as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL", message: "Enter a valid email address." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "WEAK_PASSWORD", message: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const userCount = await prisma.user.count();
  if (userCount > 0 && config.appMode !== "development") {
    return NextResponse.json(
      { error: "REGISTRATION_CLOSED", message: "Registration is currently invite-only." },
      { status: 403 },
    );
  }

  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    return NextResponse.json(
      { error: "EMAIL_TAKEN", message: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const user = await prisma.user.create({
    data: {
      email: normalized,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : null,
      passwordHash: hashPassword(password),
      profile: { create: {} },
      preferences: { create: {} },
    },
  });

  // Seed every adapter with its default on/off state. Doing this here (rather
  // than only creating the `development` row) means a new account can actually
  // search the real boards without a trip to the Sources page first.
  await ensureDefaultSources(user.id);

  await createSession(user.id);
  return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
}
