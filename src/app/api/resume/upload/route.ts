import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  ResumeValidationError,
  extractText,
  saveResumeFile,
  validateResumeFile,
  deleteResumeFile,
} from "@/lib/services/resume-parser";

export const maxDuration = 60;

export async function POST(req: Request) {
  let userId: string;
  try {
    const authUser = await requireUser();
    userId = authUser.id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  const rl = rateLimit(rateLimitKey(req, "resume-upload"), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many uploads. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "INVALID_FORM", message: "Expected multipart form data with a `file` field." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "NO_FILE", message: "No file received — attach your resume and try again." },
      { status: 400 },
    );
  }

  try {
    validateResumeFile({ name: file.name, type: file.type, size: file.size });

    // Replace any previous resume (V1: one active resume per user).
    const previous = await prisma.resume.findFirst({ where: { userId: userId } });
    if (previous) {
      await deleteResumeFile(previous.storagePath);
      await prisma.resume.delete({ where: { id: previous.id } });
    }

    const { storagePath } = await saveResumeFile(userId, file);

    const resume = await prisma.resume.create({
      data: {
        userId: userId,
        fileName: file.name.slice(0, 200),
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storagePath,
        status: "UPLOADED",
      },
    });

    // Extract text immediately so failures surface before AI costs are incurred.
    // Status is EXTRACTED, not PARSED: the AI profile pass is a separate
    // request (/api/resume/parse) and hasn't run yet at this point.
    await prisma.resume.update({ where: { id: resume.id }, data: { status: "EXTRACTING" } });
    const { text, chars } = await extractText(storagePath);
    await prisma.resume.update({
      where: { id: resume.id },
      data: { extractedText: text, status: "EXTRACTED", parseError: null },
    });

    return NextResponse.json({
      resume: {
        id: resume.id,
        fileName: resume.fileName,
        sizeBytes: resume.sizeBytes,
        chars,
        status: "EXTRACTED",
        note: "Text extracted. POST /api/resume/parse to build the AI profile.",
      },
    });
  } catch (err) {
    console.error("[resume-upload] extraction failed:", err);
    const message =
      err instanceof ResumeValidationError
        ? err.message
        : "Text extraction failed — the file may be corrupted. Try re-exporting it.";
    // Record failure on the resume row if it was created.
    const existing = await prisma.resume.findFirst({ where: { userId: userId } });
    if (existing && (existing.status === "PARSING" || existing.status === "EXTRACTING")) {
      await prisma.resume.update({
        where: { id: existing.id },
        data: { status: "FAILED", parseError: message },
      });
    }
    return NextResponse.json({ error: "EXTRACTION_FAILED", message }, { status: 422 });
  }
}
