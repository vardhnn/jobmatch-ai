import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { serializeMatch } from "@/lib/services/job-serializer";

/** GET /api/jobs/[id] — one job with its full description, match and sources. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const match = await prisma.jobMatch.findFirst({
      where: { userId: user.id, jobId: id },
      include: {
        job: {
          include: {
            analysis: true,
            sourceRecords: { include: { source: true }, orderBy: { firstSeenAt: "asc" } },
          },
        },
      },
    });

    if (!match) {
      return NextResponse.json({ error: "NOT_FOUND", message: "No match for that job." }, { status: 404 });
    }

    return NextResponse.json({
      job: {
        ...serializeMatch(match),
        analysis: match.job.analysis
          ? {
              responsibilities: safeParse(match.job.analysis.responsibilities),
              experienceRequirement: match.job.analysis.experienceRequirement,
              educationRequirement: match.job.analysis.educationRequirement,
              seniority: match.job.analysis.seniority,
              remoteType: match.job.analysis.remoteType,
              provider: match.job.analysis.provider,
            }
          : null,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("job detail error", e);
    return NextResponse.json({ error: "INTERNAL", message: "Could not load that job." }, { status: 500 });
  }
}

function safeParse(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}
