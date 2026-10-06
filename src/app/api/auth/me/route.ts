import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ user });
}
