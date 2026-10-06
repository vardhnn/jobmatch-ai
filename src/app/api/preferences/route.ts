import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import {
  sanitizePreferences,
  type PreferencesPayload,
} from "@/lib/preferences-schema";

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** Map the DB row (JSON-string arrays) to the plain-JSON payload shape. */
function serialize(row: {
  desiredRoles: string;
  workArrangement: string;
  preferredLocations: string;
  locationFlexibility: string;
  willingToRelocate: boolean;
  maxCommuteMinutes: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  includeJobsWithoutSalary: boolean;
  employmentTypes: string;
  experienceLevels: string;
  preferredCompanies: string;
  excludedCompanies: string;
  postedWithinDays: number;
  includeRelatedTitles: boolean;
  removeDuplicates: boolean;
  preferDirectApply: boolean;
  includeJobsWithoutSalarySearch: boolean;
}): PreferencesPayload {
  return {
    desiredRoles: parse<string[]>(row.desiredRoles, []),
    workArrangement: row.workArrangement,
    preferredLocations: parse<string[]>(row.preferredLocations, []),
    locationFlexibility: row.locationFlexibility,
    willingToRelocate: row.willingToRelocate,
    maxCommuteMinutes: row.maxCommuteMinutes,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
    includeJobsWithoutSalary: row.includeJobsWithoutSalary,
    employmentTypes: parse<string[]>(row.employmentTypes, []),
    experienceLevels: parse<string[]>(row.experienceLevels, []),
    preferredCompanies: parse<string[]>(row.preferredCompanies, []),
    excludedCompanies: parse<string[]>(row.excludedCompanies, []),
    postedWithinDays: row.postedWithinDays,
    includeRelatedTitles: row.includeRelatedTitles,
    removeDuplicates: row.removeDuplicates,
    preferDirectApply: row.preferDirectApply,
    includeJobsWithoutSalarySearch: row.includeJobsWithoutSalarySearch,
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    const prefs = await prisma.jobPreferences.findUnique({ where: { userId: user.id } });

    if (!prefs) {
      return NextResponse.json({ preferences: null });
    }

    return NextResponse.json({ preferences: serialize(prefs) });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
    }
    console.error("preferences GET error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not load preferences." },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  let userId: string;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Invalid JSON body." }, { status: 400 });
  }

  const { data, issues } = sanitizePreferences(body);
  if (!data) {
    return NextResponse.json(
      {
        error: "VALIDATION",
        message: issues[0]?.message ?? "Preferences are invalid.",
        issues,
      },
      { status: 422 },
    );
  }

  try {
    const stored = await prisma.jobPreferences.upsert({
      where: { userId },
      update: {
        desiredRoles: JSON.stringify(data.desiredRoles),
        workArrangement: data.workArrangement,
        preferredLocations: JSON.stringify(data.preferredLocations),
        locationFlexibility: data.locationFlexibility,
        willingToRelocate: data.willingToRelocate,
        maxCommuteMinutes: data.maxCommuteMinutes,
        salaryMin: data.salaryMin,
        salaryMax: data.salaryMax,
        salaryCurrency: data.salaryCurrency,
        salaryPeriod: data.salaryPeriod,
        includeJobsWithoutSalary: data.includeJobsWithoutSalary,
        employmentTypes: JSON.stringify(data.employmentTypes),
        experienceLevels: JSON.stringify(data.experienceLevels),
        preferredCompanies: JSON.stringify(data.preferredCompanies),
        excludedCompanies: JSON.stringify(data.excludedCompanies),
        postedWithinDays: data.postedWithinDays,
        includeRelatedTitles: data.includeRelatedTitles,
        removeDuplicates: data.removeDuplicates,
        preferDirectApply: data.preferDirectApply,
        includeJobsWithoutSalarySearch: data.includeJobsWithoutSalarySearch,
      },
      create: {
        userId,
        desiredRoles: JSON.stringify(data.desiredRoles),
        workArrangement: data.workArrangement,
        preferredLocations: JSON.stringify(data.preferredLocations),
        locationFlexibility: data.locationFlexibility,
        willingToRelocate: data.willingToRelocate,
        maxCommuteMinutes: data.maxCommuteMinutes,
        salaryMin: data.salaryMin,
        salaryMax: data.salaryMax,
        salaryCurrency: data.salaryCurrency,
        salaryPeriod: data.salaryPeriod,
        includeJobsWithoutSalary: data.includeJobsWithoutSalary,
        employmentTypes: JSON.stringify(data.employmentTypes),
        experienceLevels: JSON.stringify(data.experienceLevels),
        preferredCompanies: JSON.stringify(data.preferredCompanies),
        excludedCompanies: JSON.stringify(data.excludedCompanies),
        postedWithinDays: data.postedWithinDays,
        includeRelatedTitles: data.includeRelatedTitles,
        removeDuplicates: data.removeDuplicates,
        preferDirectApply: data.preferDirectApply,
        includeJobsWithoutSalarySearch: data.includeJobsWithoutSalarySearch,
      },
    });

    return NextResponse.json({ preferences: serialize(stored) });
  } catch (e) {
    console.error("preferences PUT error", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not save preferences." },
      { status: 500 },
    );
  }
}
