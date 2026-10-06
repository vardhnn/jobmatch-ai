"use server-only";

import type { DecisionInput } from "./types";

const norm = (s: string) => s.trim().toLowerCase();

/** Rough experience-years from free-text requirement like "2+ years". */
function requirementYears(requirement: string | null): number | null {
  if (!requirement) return null;
  const m = requirement.match(/(\d+)\s*\+?\s*years?/i);
  return m ? Number(m[1]) : null;
}

/** Candidate's implied years of experience from experience entries. */
export function candidateYears(entries: { startDate: string | null; endDate: string | null }[]): number | null {
  const now = new Date();
  let total = 0;
  let counted = false;

  for (const e of entries) {
    const start = e.startDate ? parseMonth(e.startDate) : null;
    const end = e.endDate ? parseMonth(e.endDate) : now;
    if (start && end && end >= start) {
      const years = (end.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
      total += years;
      counted = true;
    }
  }
  return counted ? Math.round(total * 10) / 10 : null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseMonth(v: string): Date | null {
  // "YYYY-MM", "YYYY", "Mon YYYY", "Present"
  const clean = v.trim();
  if (/^present$/i.test(clean)) return new Date();
  const iso = clean.match(/^(\d{4})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, 1);
  const y = clean.match(/^(19|20)\d{2}$/);
  if (y) return new Date(Number(clean), 0, 1);
  const mon = clean.match(/^([A-Za-z]{3,9})\s+((?:19|20)\d{2})$/);
  if (mon) {
    const m = MONTHS[mon[1].slice(0, 3).toLowerCase()];
    if (m !== undefined) return new Date(Number(mon[2]), m, 1);
  }
  const d = new Date(clean);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function scoreSkillMatch(
  candidateSkills: string[],
  requiredSkills: string[],
  preferredSkills: string[],
): { score: number; matching: string[]; missing: string[]; niceToHave: string[] } {
  const candidate = new Set(candidateSkills.map(norm));

  const matching = requiredSkills.filter((s) => candidate.has(norm(s)));
  const missing = requiredSkills.filter((s) => !candidate.has(norm(s)));
  const niceToHave = preferredSkills.filter((s) => !candidate.has(norm(s)));

  // Base: share of required skills covered.
  let score: number;
  if (requiredSkills.length === 0) {
    // No explicit requirements — neutral-positive rather than fake precision.
    score = 60;
  } else {
    const ratio = matching.length / requiredSkills.length;
    // Bonus for preferred-skill overlap, capped so it can't mask required gaps.
    const prefBonus = preferredSkills.length > 0
      ? (preferredSkills.filter((s) => candidate.has(norm(s))).length / preferredSkills.length) * 10
      : 0;
    score = Math.round(ratio * 90 + prefBonus);
    score = Math.max(0, Math.min(100, score));
  }

  return { score, matching, missing, niceToHave };
}

export function evaluateExperience(
  candidate: DecisionInput["candidate"],
  requirement: string | null,
  seniority: string | null,
): number | null {
  // Level-based comparison (V1: levels + optional parsed years drive this score).
  const levelRank: Record<string, number> = { ENTRY: 0, JUNIOR: 1, MID: 2, SENIOR: 3, LEAD: 4 };
  const jobSeniority = seniority ? seniority.toLowerCase() : "";
  const jobRank = /senior|sr\.?/.test(jobSeniority)
    ? 3
    : /lead|principal|staff/.test(jobSeniority)
      ? 4
      : /mid/.test(jobSeniority)
        ? 2
        : /junior|jr\.?/.test(jobSeniority)
          ? 1
          : 0;

  const reqYears = requirementYears(requirement);

  // If we can't evaluate (no levels, no requirement, no seniority), return null.
  const candidateLevels = candidate.experienceLevels;
  if (candidateLevels.length === 0 && !reqYears && !seniority) return null;

  let score: number;
  if (reqYears !== null) {
    const candYears = candidate.yearsOfExperience ?? null;
    if (candYears === null) {
      score = 50; // cannot verify — neutral, flagged as decision-support not truth
    } else if (candYears >= reqYears) {
      score = 100;
    } else {
      score = Math.max(0, Math.round((candYears / reqYears) * 100));
    }
  } else {
    const candMaxRank = Math.max(
      0,
      ...candidateLevels.map((l) => levelRank[l.toUpperCase()] ?? 0),
    );
    const diff = candMaxRank - jobRank;
    score = diff >= 0 ? 100 : Math.max(0, 100 + diff * 25);
  }

  return Math.max(0, Math.min(100, score));
}

export function evaluatePreferenceMatch(
  job: DecisionInput["job"],
  preferences: DecisionInput["preferences"],
): {
  role: number;
  location: number | null;
  salary: number | null;
  employment: number | null;
} {
  // Role: fuzzy contains either way between job title and desired roles.
  const title = norm(job.title);
  let role = 0;
  let best = 0;
  for (const r of preferences.desiredRoles) {
    const rn = norm(r);
    if (!rn) continue;
    let s = 0;
    if (title === rn) s = 100;
    else if (title.includes(rn) || rn.includes(title)) s = 85;
    else {
      // token overlap
      const t = new Set(title.split(/[^a-z0-9+#.]+/).filter(Boolean));
      const rr = rn.split(/[^a-z0-9+#.]+/).filter(Boolean);
      const overlap = rr.filter((w) => t.has(w)).length;
      s = rr.length > 0 ? Math.round((overlap / rr.length) * 70) : 0;
    }
    best = Math.max(best, s);
  }
  role = Math.min(100, best);

  // Location
  let location: number | null = null;
  const jobLoc = job.location ? norm(job.location) : null;
  if (preferences.workArrangement === "ANY") {
    location = 100;
  } else if (job.remoteType === "REMOTE" && preferences.workArrangement === "REMOTE") {
    location = 100;
  } else if (
    preferences.workArrangement !== "REMOTE" &&
    preferences.workArrangement !== "ANY" &&
    jobLoc
  ) {
    const cityMatch = preferences.preferredLocations.some((l) => {
      const ln = norm(l);
      const city = ln.split(",")[0].trim();
      return jobLoc.includes(city) || ln.includes(jobLoc);
    });
    if (cityMatch) location = 100;
    else if (preferences.locationFlexibility === "WORLDWIDE") location = 90;
    else if (preferences.locationFlexibility === "COUNTRY") {
      const country = preferences.preferredLocations[0]?.split(",").pop()?.trim().toLowerCase();
      location = country && jobLoc.includes(country) ? 80 : 40;
    } else location = 40;
    if (preferences.willingToRelocate && location < 80) location = Math.min(80, location + 20);
  } else if (!jobLoc && job.remoteType === "UNKNOWN") {
    location = null; // cannot evaluate — don't pretend
  } else {
    location = 50;
  }

  // Salary: overlap between job range and preferred range; null if either missing
  let salary: number | null = null;
  if (job.salaryMin !== null || job.salaryMax !== null) {
    const jMin = job.salaryMin ?? 0;
    const jMax = job.salaryMax ?? job.salaryMin ?? 0;
    const pMin = preferences.salaryMin;
    const pMax = preferences.salaryMax;

    if (pMin === null && pMax === null) {
      salary = 70; // no preference stated — mild positive if job states one
    } else {
      const effMin = pMin ?? 0;
      const effMax = pMax ?? Number.MAX_SAFE_INTEGER;
      const overlap = Math.max(0, Math.min(jMax, effMax) - Math.max(jMin, effMin));
      const jobSpan = jMax - jMin;
      if (jobSpan <= 0) {
        salary = jMin >= effMin && jMin <= effMax ? 100 : 30;
      } else {
        salary = Math.round((overlap / jobSpan) * 100);
        // Currency mismatch penalizes slightly rather than fabricating conversion
        if (job.salaryCurrency && job.salaryCurrency !== preferences.salaryCurrency) {
          salary = Math.min(salary, 40);
        }
      }
    }
  } else if (!preferences.includeJobsWithoutSalary) {
    salary = 0;
  }

  // Employment type
  let employment: number | null = null;
  if (preferences.employmentTypes.length > 0) {
    const jobType = job.employmentType ? norm(job.employmentType) : null;
    if (!jobType) {
      employment = null; // unknown — excluded from weighting
    } else {
      const mapped = jobType.includes("full") ? "FULL_TIME" : jobType.includes("part") ? "PART_TIME" : jobType.includes("intern") ? "INTERNSHIP" : jobType.includes("contract") ? "CONTRACT" : jobType.includes("temp") ? "TEMPORARY" : null;
      employment = mapped && preferences.employmentTypes.includes(mapped) ? 100 : 20;
    }
  }

  return { role, location, salary, employment };
}
