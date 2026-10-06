"use server-only";

import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import { config } from "@/lib/config";

/**
 * ResumeParser — file intake + text extraction.
 *
 * Validation and extraction are deterministic; AI structuring happens
 * separately in the AIProvider (parseResume) so the expensive model call
 * is never repeated on re-uploads that fail validation.
 */

export const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const ALLOWED_EXT = [".pdf", ".docx"] as const;

export class ResumeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeValidationError";
  }
}

export function validateResumeFile(file: { name: string; type: string; size: number }) {
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
    throw new ResumeValidationError("Unsupported file type — upload a PDF or DOCX resume.");
  }
  // Some browsers send empty/generic MIME; extension is the primary gate.
  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    !ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])
  ) {
    throw new ResumeValidationError("Unsupported file format — PDF and DOCX only.");
  }
  if (file.size <= 0) {
    throw new ResumeValidationError("The file appears to be empty.");
  }
  if (file.size > config.limits.maxResumeBytes) {
    throw new ResumeValidationError(
      `File too large — maximum ${Math.round(config.limits.maxResumeBytes / 1024 / 1024)}MB.`,
    );
  }
}

/** Secure-ish storage name: no user-controlled path components survive. */
export function storageFileName(userId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${userId}_${stamp}${rand}${ext}`;
}

export async function saveResumeFile(userId: string, file: File): Promise<{ storagePath: string; absPath: string }> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const name = storageFileName(userId, file.name);
  const absPath = path.join(uploadsDir, name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(absPath, buffer);
  return { storagePath: name, absPath };
}

export async function readResumeFile(storagePath: string): Promise<Buffer> {
  const absPath = path.join(process.cwd(), "uploads", path.basename(storagePath));
  return readFile(absPath);
}

export async function deleteResumeFile(storagePath: string): Promise<void> {
  const absPath = path.join(process.cwd(), "uploads", path.basename(storagePath));
  await unlink(absPath).catch(() => undefined);
}

export type ExtractResult = { text: string; chars: number };

export async function extractText(storagePath: string): Promise<ExtractResult> {
  const buffer = await readResumeFile(storagePath);
  const ext = path.extname(storagePath).toLowerCase();

  if (ext === ".pdf") {
    // unpdf: pure-JS PDF text extraction, serverless-friendly.
    const { extractText: unpdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await unpdfExtract(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    const cleaned = merged.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!cleaned || cleaned.length < 40) {
      throw new ResumeValidationError(
        "Could not extract readable text — the PDF may be a scan (image-based).",
      );
    }
    return { text: cleaned, chars: cleaned.length };
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    const cleaned = value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!cleaned || cleaned.length < 40) {
      throw new ResumeValidationError("Could not extract readable text from the DOCX.");
    }
    return { text: cleaned, chars: cleaned.length };
  }

  throw new ResumeValidationError("Unsupported file type — PDF and DOCX only.");
}
