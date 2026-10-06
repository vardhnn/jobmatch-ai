/**
 * Shared job-preferences vocabulary + validation.
 *
 * Client-safe (no "use server-only"): the preferences form imports the option
 * lists for rendering and the same `sanitizePreferences` used by the API route,
 * so the browser pre-validates exactly what the server will accept.
 */

export const WORK_ARRANGEMENTS = ["REMOTE", "HYBRID", "ONSITE", "ANY"] as const;
export const LOCATION_FLEXIBILITY = ["SELECTED_ONLY", "COUNTRY", "WORLDWIDE"] as const;
export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "INTERNSHIP",
  "CONTRACT",
  "TEMPORARY",
] as const;
export const EXPERIENCE_LEVELS = [
  "ENTRY",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "PRINCIPAL",
] as const;
export const SALARY_PERIODS = ["ANNUAL", "MONTHLY", "HOURLY"] as const;
export const SALARY_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SGD",
  "AUD",
  "CAD",
] as const;
export const FRESHNESS_OPTIONS = [
  { days: 1, label: "PAST 24 HOURS" },
  { days: 3, label: "PAST 3 DAYS" },
  { days: 7, label: "PAST WEEK" },
  { days: 14, label: "PAST 2 WEEKS" },
  { days: 30, label: "PAST MONTH" },
  { days: 60, label: "PAST 2 MONTHS" },
] as const;

export const MAX_ROLES = 10;
export const MAX_LOCATIONS = 10;
export const MAX_COMPANIES = 25;

export type PreferencesState = {
  desiredRoles: string[];
  workArrangement: string;
  preferredLocations: string[];
  locationFlexibility: string;
  willingToRelocate: boolean;
  maxCommuteMinutes: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  includeJobsWithoutSalary: boolean;
  employmentTypes: string[];
  experienceLevels: string[];
  preferredCompanies: string[];
  excludedCompanies: string[];
  postedWithinDays: number;
  includeRelatedTitles: boolean;
  removeDuplicates: boolean;
  preferDirectApply: boolean;
  includeJobsWithoutSalarySearch: boolean;
};

export const EMPTY_PREFERENCES: PreferencesState = {
  desiredRoles: [],
  workArrangement: "ANY",
  preferredLocations: [],
  locationFlexibility: "SELECTED_ONLY",
  willingToRelocate: false,
  maxCommuteMinutes: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "USD",
  salaryPeriod: "ANNUAL",
  includeJobsWithoutSalary: true,
  employmentTypes: ["FULL_TIME"],
  experienceLevels: ["MID"],
  preferredCompanies: [],
  excludedCompanies: [],
  postedWithinDays: 14,
  includeRelatedTitles: true,
  removeDuplicates: true,
  preferDirectApply: true,
  includeJobsWithoutSalarySearch: true,
};

/** Row shape returned to / expected from the client (arrays are plain JSON). */
export type PreferencesPayload = Omit<
  PreferencesState,
  "maxCommuteMinutes" | "salaryMin" | "salaryMax"
> & {
  maxCommuteMinutes: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
};

export type PreferencesIssue = { field: string; message: string };

export const MAX_SALARY = 100_000_000;

const isOneOf = <T extends readonly string[]>(v: unknown, allowed: T): v is T[number] =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** Trim, drop blanks, dedupe case-insensitively, preserve original casing. */
function cleanList(v: unknown, limit: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function pickSubset<T extends readonly string[]>(v: unknown, allowed: T): T[number][] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: T[number][] = [];
  for (const raw of v) {
    const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!isOneOf(s, allowed) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;

/**
 * Validate + normalize an untrusted preferences payload.
 * Returns the DB-ready data plus human-readable issues (empty when valid).
 */
export function sanitizePreferences(input: unknown): {
  data: PreferencesPayload | null;
  issues: PreferencesIssue[];
} {
  const issues: PreferencesIssue[] = [];
  const b = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  // ── Roles ──────────────────────────────────────────────────────────────
  const desiredRoles = cleanList(b.desiredRoles, MAX_ROLES, 80);
  if (desiredRoles.length === 0) {
    issues.push({ field: "desiredRoles", message: "Add at least one desired role." });
  }

  // ── Work arrangement / location ───────────────────────────────────────
  let workArrangement = EMPTY_PREFERENCES.workArrangement;
  if (!isOneOf(b.workArrangement, WORK_ARRANGEMENTS)) {
    if (b.workArrangement !== undefined) {
      issues.push({ field: "workArrangement", message: "Unknown work arrangement." });
    }
  } else {
    workArrangement = b.workArrangement;
  }

  let locationFlexibility = EMPTY_PREFERENCES.locationFlexibility;
  if (!isOneOf(b.locationFlexibility, LOCATION_FLEXIBILITY)) {
    if (b.locationFlexibility !== undefined) {
      issues.push({
        field: "locationFlexibility",
        message: "Unknown location flexibility.",
      });
    }
  } else {
    locationFlexibility = b.locationFlexibility;
  }

  const preferredLocations = cleanList(b.preferredLocations, MAX_LOCATIONS, 80);
  if (locationFlexibility === "SELECTED_ONLY" && preferredLocations.length === 0) {
    issues.push({
      field: "preferredLocations",
      message: "Add a location, or widen location flexibility.",
    });
  }

  const willingToRelocate = bool(b.willingToRelocate, EMPTY_PREFERENCES.willingToRelocate);

  const commuteRaw = toInt(b.maxCommuteMinutes);
  let maxCommuteMinutes: number | null = null;
  if (Number.isNaN(commuteRaw)) {
    issues.push({ field: "maxCommuteMinutes", message: "Max commute must be a number." });
  } else if (commuteRaw !== null) {
    if (commuteRaw < 5 || commuteRaw > 300) {
      issues.push({ field: "maxCommuteMinutes", message: "Max commute must be 5–300 minutes." });
    } else {
      maxCommuteMinutes = commuteRaw;
    }
  }

  // ── Salary ────────────────────────────────────────────────────────────
  const salaryMinRaw = toInt(b.salaryMin);
  const salaryMaxRaw = toInt(b.salaryMax);
  for (const [field, n] of [
    ["salaryMin", salaryMinRaw],
    ["salaryMax", salaryMaxRaw],
  ] as const) {
    if (Number.isNaN(n)) {
      issues.push({ field, message: "Salary must be a number." });
    } else if (n !== null && (n < 0 || n > MAX_SALARY)) {
      issues.push({ field, message: `Salary must be between 0 and ${MAX_SALARY.toLocaleString()}.` });
    }
  }
  let salaryMin = Number.isNaN(salaryMinRaw) ? null : salaryMinRaw;
  let salaryMax = Number.isNaN(salaryMaxRaw) ? null : salaryMaxRaw;
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    issues.push({ field: "salaryMax", message: "Maximum salary is below the minimum." });
    [salaryMin, salaryMax] = [null, null];
  }

  const salaryCurrency = isOneOf(b.salaryCurrency, SALARY_CURRENCIES)
    ? b.salaryCurrency
    : EMPTY_PREFERENCES.salaryCurrency;
  const salaryPeriod = isOneOf(b.salaryPeriod, SALARY_PERIODS)
    ? b.salaryPeriod
    : EMPTY_PREFERENCES.salaryPeriod;

  // ── Employment & experience ───────────────────────────────────────────
  const employmentTypes = pickSubset(b.employmentTypes, EMPLOYMENT_TYPES);
  if (employmentTypes.length === 0) {
    issues.push({ field: "employmentTypes", message: "Pick at least one employment type." });
  }
  const experienceLevels = pickSubset(b.experienceLevels, EXPERIENCE_LEVELS);
  if (experienceLevels.length === 0) {
    issues.push({ field: "experienceLevels", message: "Pick at least one experience level." });
  }

  // ── Companies ─────────────────────────────────────────────────────────
  const preferredCompanies = cleanList(b.preferredCompanies, MAX_COMPANIES, 100);
  const excludedCompanies = cleanList(b.excludedCompanies, MAX_COMPANIES, 100);
  const excludedKeys = new Set(excludedCompanies.map((c) => c.toLowerCase()));
  const clash = preferredCompanies.find((c) => excludedKeys.has(c.toLowerCase()));
  if (clash) {
    issues.push({
      field: "excludedCompanies",
      message: `"${clash}" cannot be both preferred and excluded.`,
    });
  }

  // ── Freshness & search behaviour ──────────────────────────────────────
  // Omitted -> default; present but not an allowed window -> hard error.
  const postedRaw = toInt(b.postedWithinDays);
  const allowedDays = FRESHNESS_OPTIONS.map((o) => o.days);
  let postedWithinDays = EMPTY_PREFERENCES.postedWithinDays;
  if (b.postedWithinDays !== undefined && b.postedWithinDays !== null && b.postedWithinDays !== "") {
    if (postedRaw !== null && !Number.isNaN(postedRaw) && allowedDays.includes(postedRaw as 1)) {
      postedWithinDays = postedRaw;
    } else {
      issues.push({ field: "postedWithinDays", message: "Pick a job-age window." });
    }
  }

  const data: PreferencesPayload = {
    desiredRoles,
    workArrangement,
    preferredLocations,
    locationFlexibility,
    willingToRelocate,
    maxCommuteMinutes,
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    includeJobsWithoutSalary: bool(
      b.includeJobsWithoutSalary,
      EMPTY_PREFERENCES.includeJobsWithoutSalary,
    ),
    employmentTypes,
    experienceLevels,
    preferredCompanies,
    excludedCompanies,
    postedWithinDays,
    includeRelatedTitles: bool(b.includeRelatedTitles, EMPTY_PREFERENCES.includeRelatedTitles),
    removeDuplicates: bool(b.removeDuplicates, EMPTY_PREFERENCES.removeDuplicates),
    preferDirectApply: bool(b.preferDirectApply, EMPTY_PREFERENCES.preferDirectApply),
    includeJobsWithoutSalarySearch: bool(
      b.includeJobsWithoutSalarySearch,
      EMPTY_PREFERENCES.includeJobsWithoutSalarySearch,
    ),
  };

  return { data: issues.length === 0 ? data : null, issues };
}
