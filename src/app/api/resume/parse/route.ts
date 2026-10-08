import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getAIProvider } from "@/lib/ai";
import { parseAiCredential } from "@/lib/ai/credential-header";

export const maxDuration = 120;

/** Best-effort skill categorization for the profile page's grouped display. */
function categorizeSkill(name: string): string {
  const s = name.toLowerCase();
  const table: [RegExp, string][] = [
    [/^(python|java|typescript|javascript|c\+\+|c#|go|rust|ruby|php|kotlin|swift|sql|bash|scala|r)$/i, "Programming"],
    [/^(react|next\.?js|vue|angular|svelte|django|flask|fastapi|spring|\.net|rails|laravel|express|nest\.?js)$/i, "Frameworks"],
    [/^(redux|tailwind|graphql|webpack|vite|jest|cypress|playwright|vitest|axios)$/i, "Libraries"],
    [/^(postgresql|postgres|mysql|sqlite|mongodb|redis|elasticsearch|dynamo ?db|cassandra|mariadb|mssql)$/i, "Databases"],
    [/^(aws|azure|gcp|google cloud|lambda|s3|ec2|dynamodb)$/i, "Cloud"],
    [/^(docker|kubernetes|terraform|ansible|jenkins|ci\/cd|linux|nginx|helm)$/i, "DevOps"],
    [/^(tensorflow|pytorch|scikit-learn|pandas|numpy|nlp|llm|openai|machine learning|deep learning)$/i, "AI_ML"],
    [/^(git|github|gitlab|jira|figma|postman|vs code|slack)$/i, "Tools"],
  ];
  for (const [re, cat] of table) {
    if (re.test(s.trim())) return cat;
  }
  return "Other";
}

export async function POST(req: Request) {
  let userId: string;
  try {
    const authUser = await requireUser();
    userId = authUser.id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  // BYOK: resume parsing is a pure AI feature — it cannot run without a key.
  const credential = parseAiCredential(req);
  if (!credential) {
    return NextResponse.json(
      {
        error: "AI_NOT_CONFIGURED",
        message: "Add your AI API key in Settings → Intelligence Layer to parse resumes.",
      },
      { status: 403 },
    );
  }

  const rl = rateLimit(rateLimitKey(req, "resume-parse"), 6, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many parse attempts. Wait a minute." },
      { status: 429 },
    );
  }

  const resume = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (!resume?.extractedText) {
    return NextResponse.json(
      { error: "NO_RESUME", message: "Upload a resume first — nothing to parse yet." },
      { status: 400 },
    );
  }

  try {
    await prisma.resume.update({ where: { id: resume.id }, data: { status: "PARSING", parseError: null } });

    const ai = getAIProvider(credential);
    const parsed = await ai.parseResume(resume.extractedText);
    const providerName = ai.name;

    // Persist into the structured candidate profile (upsert — re-parse replaces).
    const profile = await prisma.candidateProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    // Replace profile contents transactionally.
    await prisma.$transaction([
      prisma.experience.deleteMany({ where: { profileId: profile.id } }),
      prisma.education.deleteMany({ where: { profileId: profile.id } }),
      prisma.project.deleteMany({ where: { profileId: profile.id } }),
      prisma.skill.deleteMany({ where: { profileId: profile.id } }),
    ]);

    await prisma.$transaction([
      // Keep existing basic info if the user edited it and AI found nothing.
      prisma.candidateProfile.update({
        where: { id: profile.id },
        data: {
          name: parsed.name ?? undefined,
          email: parsed.email ?? undefined,
          phone: parsed.phone ?? undefined,
          linkedin: parsed.linkedin ?? undefined,
          github: parsed.github ?? undefined,
          portfolio: parsed.portfolio ?? undefined,
          summary: parsed.summary ?? undefined,
        },
      }),
      prisma.experience.createMany({
        data: parsed.experiences.map((e, i) => ({
          profileId: profile.id,
          company: e.company,
          role: e.role,
          startDate: e.startDate,
          endDate: e.endDate,
          description: e.description,
          technologies: e.technologies.join(", "),
          sortOrder: i,
        })),
      }),
      prisma.education.createMany({
        data: parsed.education.map((e, i) => ({
          profileId: profile.id,
          institution: e.institution,
          degree: e.degree,
          field: e.field,
          startYear: e.startYear,
          graduationYear: e.graduationYear,
          sortOrder: i,
        })),
      }),
      prisma.project.createMany({
        data: parsed.projects.map((p, i) => ({
          profileId: profile.id,
          name: p.name,
          description: p.description,
          technologies: p.technologies.join(", "),
          url: p.url,
          sortOrder: i,
        })),
      }),
      prisma.skill.createMany({
        data: [...new Set(parsed.skills)].slice(0, 60).map((s, i) => ({
          profileId: profile.id,
          name: s,
          category: categorizeSkill(s),
          sortOrder: i,
        })),
      }),
    ]);

    await prisma.resume.update({ where: { id: resume.id }, data: { status: "PARSED" } });

    const counts = {
      skills: parsed.skills.length,
      experiences: parsed.experiences.length,
      education: parsed.education.length,
      projects: parsed.projects.length,
    };

    return NextResponse.json({ ok: true, provider: providerName, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resume parsing failed.";
    await prisma.resume
      .update({ where: { id: resume.id }, data: { status: "FAILED", parseError: message.slice(0, 500) } })
      .catch(() => undefined);
    return NextResponse.json(
      {
        error: "PARSE_FAILED",
        message:
          "AI resume parsing failed. Your file is saved — you can retry, or fill your profile manually.",
      },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const authUser = await requireUser();
    const resume = await prisma.resume.findFirst({
      where: { userId: authUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        sizeBytes: true,
        status: true,
        parseError: true,
        createdAt: true,
      },
    });
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: authUser.id },
      select: { _count: { select: { skills: true, experiences: true, education: true, projects: true } } },
    });
    return NextResponse.json({ resume, profileCounts: profile?._count ?? null });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    return NextResponse.json({ error: "INTERNAL", message: "Could not load resume status." }, { status: 500 });
  }
}
