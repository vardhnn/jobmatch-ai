import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";

type ExperienceInput = {
  id?: string;
  company?: string;
  role?: string;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  technologies?: string | null;
};
type EducationInput = {
  id?: string;
  institution?: string;
  degree?: string;
  field?: string | null;
  startYear?: number | null;
  graduationYear?: number | null;
};
type ProjectInput = {
  id?: string;
  name?: string;
  description?: string | null;
  technologies?: string | null;
  url?: string | null;
};
type SkillInput = { id?: string; name?: string; category?: string; level?: string | null };

type ProfileBody = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  github?: string | null;
  portfolio?: string | null;
  summary?: string | null;
  experiences?: ExperienceInput[];
  education?: EducationInput[];
  projects?: ProjectInput[];
  skills?: SkillInput[];
};

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s.slice(0, max) : null;
};

const clampYear = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1950 && n <= 2100 ? Math.round(n) : null;
};

export async function GET() {
  try {
    const authUser = await requireUser();
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: authUser.id },
      include: {
        experiences: { orderBy: { sortOrder: "asc" } },
        education: { orderBy: { sortOrder: "asc" } },
        projects: { orderBy: { sortOrder: "asc" } },
        skills: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
      },
    });
    return NextResponse.json({ profile });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("profile GET error", e);
    return NextResponse.json({ error: "INTERNAL", message: "Could not load profile." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let userId: string;
  try {
    const authUser = await requireUser();
    userId = authUser.id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  let body: ProfileBody;
  try {
    body = (await req.json()) as ProfileBody;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const profile = await prisma.candidateProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    // Strategy: update scalars; replace nested lists wholesale (simple, correct
    // for a personal V1 — client sends the full edited lists).
    const data: Parameters<typeof prisma.candidateProfile.update>[0]["data"] = {};
    if ("name" in body) data.name = clip(body.name, 120);
    if ("email" in body) data.email = clip(body.email, 200);
    if ("phone" in body) data.phone = clip(body.phone, 40);
    if ("linkedin" in body) data.linkedin = clip(body.linkedin, 300);
    if ("github" in body) data.github = clip(body.github, 300);
    if ("portfolio" in body) data.portfolio = clip(body.portfolio, 300);
    if ("summary" in body) data.summary = clip(body.summary, 1500);

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.candidateProfile.update({ where: { id: profile.id }, data });
      }

      if (Array.isArray(body.experiences)) {
        await tx.experience.deleteMany({ where: { profileId: profile.id } });
        const rows = body.experiences
          .filter((e) => (e.company ?? "").trim() || (e.role ?? "").trim())
          .slice(0, 25)
          .map((e, i) => ({
            profileId: profile.id,
            company: clip(e.company, 160) ?? "Unknown",
            role: clip(e.role, 160) ?? "Unknown",
            startDate: clip(e.startDate, 20),
            endDate: clip(e.endDate, 20),
            description: clip(e.description, 3000),
            technologies: clip(e.technologies, 500),
            sortOrder: i,
          }));
        if (rows.length) await tx.experience.createMany({ data: rows });
      }

      if (Array.isArray(body.education)) {
        await tx.education.deleteMany({ where: { profileId: profile.id } });
        const rows = body.education
          .filter((e) => (e.institution ?? "").trim() || (e.degree ?? "").trim())
          .slice(0, 15)
          .map((e, i) => ({
            profileId: profile.id,
            institution: clip(e.institution, 200) ?? "Unknown",
            degree: clip(e.degree, 200) ?? "Unknown",
            field: clip(e.field, 200),
            startYear: clampYear(e.startYear),
            graduationYear: clampYear(e.graduationYear),
            sortOrder: i,
          }));
        if (rows.length) await tx.education.createMany({ data: rows });
      }

      if (Array.isArray(body.projects)) {
        await tx.project.deleteMany({ where: { profileId: profile.id } });
        const rows = body.projects
          .filter((p) => (p.name ?? "").trim())
          .slice(0, 20)
          .map((p, i) => ({
            profileId: profile.id,
            name: clip(p.name, 200) ?? "Unknown",
            description: clip(p.description, 2000),
            technologies: clip(p.technologies, 500),
            url: clip(p.url, 300),
            sortOrder: i,
          }));
        if (rows.length) await tx.project.createMany({ data: rows });
      }

      if (Array.isArray(body.skills)) {
        await tx.skill.deleteMany({ where: { profileId: profile.id } });
        const seen = new Set<string>();
        const rows: { profileId: string; name: string; category: string; level: string | null; sortOrder: number }[] = [];
        for (const s of body.skills.slice(0, 80)) {
          const name = clip(s.name, 60);
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            profileId: profile.id,
            name,
            category: clip(s.category, 20) ?? "Other",
            level: clip(s.level, 20),
            sortOrder: rows.length,
          });
        }
        if (rows.length) await tx.skill.createMany({ data: rows });
      }
    });

    const updated = await prisma.candidateProfile.findUnique({
      where: { userId },
      include: {
        experiences: { orderBy: { sortOrder: "asc" } },
        education: { orderBy: { sortOrder: "asc" } },
        projects: { orderBy: { sortOrder: "asc" } },
        skills: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
      },
    });
    return NextResponse.json({ profile: updated });
  } catch (e) {
    console.error("profile PUT error", e);
    return NextResponse.json({ error: "INTERNAL", message: "Could not save profile." }, { status: 500 });
  }
}
