import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { config, publicConfig } from "@/lib/config";

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** GET /api/dashboard — everything the dashboard renders in one round-trip. */
export async function GET() {
  try {
    const user = await requireUser();

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [
      profile,
      resume,
      prefs,
      newToday,
      strong,
      potential,
      low,
      lastRun,
      recentRuns,
      topMatches,
      unread,
    ] = await Promise.all([
      prisma.candidateProfile.findUnique({
        where: { userId: user.id },
        include: { skills: true },
      }),
      prisma.resume.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
      prisma.jobPreferences.findUnique({ where: { userId: user.id } }),
      prisma.jobMatch.count({
        where: { userId: user.id, decision: "SHOW", job: { createdAt: { gte: dayStart } } },
      }),
      prisma.jobMatch.count({ where: { userId: user.id, category: "STRONG", decision: "SHOW" } }),
      prisma.jobMatch.count({ where: { userId: user.id, category: "POTENTIAL", decision: "SHOW" } }),
      prisma.jobMatch.count({ where: { userId: user.id, category: "LOW", decision: "SHOW" } }),
      prisma.searchRun.findFirst({
        where: { userId: user.id },
        orderBy: { startedAt: "desc" },
        include: { queries: { where: { approved: true }, orderBy: { query: "asc" } } },
      }),
      prisma.searchRun.findMany({
        where: { userId: user.id },
        orderBy: { startedAt: "desc" },
        take: 7,
      }),
      prisma.jobMatch.findMany({
        where: { userId: user.id, decision: "SHOW" },
        include: { job: true },
        orderBy: { overall: "desc" },
        take: 6,
      }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);

    const avg =
      topMatches.length > 0
        ? Math.round(topMatches.reduce((a, m) => a + m.overall, 0) / topMatches.length)
        : null;

    const runErrors = lastRun ? parse<{ source: string; code: string; message: string }[]>(lastRun.sourceErrors, []) : [];
    const runNotes = lastRun ? parse<string[]>(lastRun.sourceNotes, []) : [];
    const runSearched = lastRun ? parse<string[]>(lastRun.searchedQueries, []) : [];

    return NextResponse.json({
      stats: { newToday, strong, potential, low, unread, averageScore: avg },
      readiness: {
        hasResume: Boolean(resume),
        hasProfile: Boolean(profile && profile.skills.length > 0),
        hasPreferences: Boolean(
          prefs && parse<string[]>(prefs.desiredRoles, []).length > 0,
        ),
        skillCount: profile?.skills.length ?? 0,
        desiredRoles: prefs ? parse<string[]>(prefs.desiredRoles, []) : [],
        postedWithinDays: prefs?.postedWithinDays ?? 14,
      },
      engines: {
        aiModel: config.ai.model,
        aiFallbacks: config.ai.fallbackModels,
        aiProvider: config.ai.provider,
        decisionModel: config.decision.jevModel,
        decisionProvider: config.decision.provider,
        public: publicConfig(),
      },
      // The run summary is rendered from this on a cold load, so it carries
      // everything the live panel shows — not just the counters.
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            trigger: lastRun.trigger,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            totalFound: lastRun.totalFound,
            newJobs: lastRun.newJobs,
            duplicates: lastRun.duplicates,
            analyzed: lastRun.analyzed,
            sourcesTried: lastRun.sourcesTried,
            strongMatches: lastRun.strongMatches,
            potentialMatches: lastRun.potentialMatches,
            queries: lastRun.queries.map((q) => q.query),
            searchedTerms: runSearched.length
              ? runSearched
              : lastRun.queries.filter((q) => q.approved).map((q) => q.query),
            errors: runErrors,
            notes: runNotes,
          }
        : null,
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger,
        startedAt: r.startedAt,
        newJobs: r.newJobs,
        totalFound: r.totalFound,
        strongMatches: r.strongMatches,
        potentialMatches: r.potentialMatches,
      })),
      topMatches: topMatches.map((m) => ({
        jobId: m.jobId,
        title: m.job.title,
        company: m.job.company,
        location: m.job.location,
        overall: m.overall,
        category: m.category,
        provider: m.provider,
        applicationUrl: m.job.applicationUrl,
        subScores: {
          skills: m.skillsScore,
          experience: m.experienceScore,
          role: m.roleScore,
          location: m.locationScore,
          salary: m.salaryScore,
          employment: m.employmentScore,
        },
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("dashboard error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not load the dashboard." },
      { status: 500 },
    );
  }
}
