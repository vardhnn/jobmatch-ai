import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const rl = rateLimit(rateLimitKey(req, "login"), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many login attempts. Try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as { email?: string; password?: string };
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim().length < 3 ||
    password.length < 1
  ) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "Email and password are required." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Constant-shape response: never reveal whether the account exists.
  const valid = user ? verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) {
    return NextResponse.json(
      { error: "INVALID_CREDENTIALS", message: "Incorrect email or password." },
      { status: 401 },
    );
  }

  await createSession(user.id);
  return NextResponse.json({ id: user.id, email: user.email, name: user.name });
}
