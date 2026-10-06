import { describe, it, expect } from "vitest";
import {
  sanitizePreferences,
  EMPTY_PREFERENCES,
  FRESHNESS_OPTIONS,
} from "@/lib/preferences-schema";

/** Minimal valid payload the tests mutate. */
const base = () => ({
  desiredRoles: ["Backend Engineer"],
  workArrangement: "HYBRID",
  preferredLocations: ["Bengaluru"],
  locationFlexibility: "SELECTED_ONLY",
  willingToRelocate: true,
  maxCommuteMinutes: 45,
  salaryMin: 1800000,
  salaryMax: 2400000,
  salaryCurrency: "INR",
  salaryPeriod: "ANNUAL",
  includeJobsWithoutSalary: true,
  employmentTypes: ["FULL_TIME"],
  experienceLevels: ["MID"],
  preferredCompanies: [],
  excludedCompanies: [],
  postedWithinDays: 7,
  includeRelatedTitles: true,
  removeDuplicates: true,
  preferDirectApply: true,
  includeJobsWithoutSalarySearch: true,
});

const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe("sanitizePreferences", () => {
  it("accepts a complete payload unchanged", () => {
    const { data, issues } = sanitizePreferences(base());
    expect(issues).toEqual([]);
    expect(data).toEqual(base());
  });

  it("trims, collapses whitespace and dedupes lists case-insensitively", () => {
    const { data } = sanitizePreferences({
      ...base(),
      desiredRoles: ["  Backend   Engineer ", "backend engineer", "Platform Engineer"],
    });
    expect(data?.desiredRoles).toEqual(["Backend Engineer", "Platform Engineer"]);
  });

  it("caps list lengths", () => {
    const { data } = sanitizePreferences({
      ...base(),
      desiredRoles: Array.from({ length: 50 }, (_, i) => `Role ${i}`),
    });
    expect(data?.desiredRoles).toHaveLength(10);
  });

  it("coerces numeric strings from form inputs", () => {
    const { data } = sanitizePreferences({
      ...base(),
      salaryMin: "1500000",
      salaryMax: "2000000",
      maxCommuteMinutes: "30",
    });
    expect(data?.salaryMin).toBe(1500000);
    expect(data?.salaryMax).toBe(2000000);
    expect(data?.maxCommuteMinutes).toBe(30);
  });

  it("treats blank numeric fields as unset", () => {
    const { data } = sanitizePreferences({ ...base(), salaryMin: "", maxCommuteMinutes: "" });
    expect(data?.salaryMin).toBeNull();
    expect(data?.maxCommuteMinutes).toBeNull();
  });

  it("requires at least one role", () => {
    const { data, issues } = sanitizePreferences({ ...base(), desiredRoles: [] });
    expect(data).toBeNull();
    expect(fields(issues)).toContain("desiredRoles");
  });

  it("requires a location when flexibility is LISTED ONLY", () => {
    const { data, issues } = sanitizePreferences({ ...base(), preferredLocations: [] });
    expect(data).toBeNull();
    expect(fields(issues)).toContain("preferredLocations");
  });

  it("allows an empty location list once flexibility is widened", () => {
    const { data } = sanitizePreferences({
      ...base(),
      preferredLocations: [],
      locationFlexibility: "WORLDWIDE",
    });
    expect(data?.locationFlexibility).toBe("WORLDWIDE");
  });

  it("rejects an inverted salary range", () => {
    const { data, issues } = sanitizePreferences({ ...base(), salaryMin: 900, salaryMax: 100 });
    expect(data).toBeNull();
    expect(fields(issues)).toContain("salaryMax");
  });

  it("rejects out-of-range commute", () => {
    const { data, issues } = sanitizePreferences({ ...base(), maxCommuteMinutes: 900 });
    expect(data).toBeNull();
    expect(fields(issues)).toContain("maxCommuteMinutes");
  });

  it("rejects unknown enum values", () => {
    const { data, issues } = sanitizePreferences({
      ...base(),
      workArrangement: "MOON",
      employmentTypes: ["GHOST"],
    });
    expect(data).toBeNull();
    expect(fields(issues)).toEqual(
      expect.arrayContaining(["workArrangement", "employmentTypes"]),
    );
  });

  it("drops unknown members of a mixed-type list instead of failing", () => {
    const { data, issues } = sanitizePreferences({
      ...base(),
      experienceLevels: ["mid", "SENIOR", "ROCKET", 42],
    });
    expect(issues).toEqual([]);
    expect(data?.experienceLevels).toEqual(["MID", "SENIOR"]);
  });

  it("rejects a company that is both preferred and excluded", () => {
    const { data, issues } = sanitizePreferences({
      ...base(),
      preferredCompanies: ["Acme"],
      excludedCompanies: ["acme"],
    });
    expect(data).toBeNull();
    expect(fields(issues)).toContain("excludedCompanies");
  });

  it("defaults an omitted freshness window but rejects a bogus one", () => {
    expect(sanitizePreferences({ ...base(), postedWithinDays: undefined }).data?.postedWithinDays).toBe(
      EMPTY_PREFERENCES.postedWithinDays,
    );
    const bad = sanitizePreferences({ ...base(), postedWithinDays: 45 });
    expect(bad.data).toBeNull();
    expect(fields(bad.issues)).toContain("postedWithinDays");
  });

  it("accepts every advertised freshness window", () => {
    for (const opt of FRESHNESS_OPTIONS) {
      expect(sanitizePreferences({ ...base(), postedWithinDays: opt.days }).data?.postedWithinDays).toBe(
        opt.days,
      );
    }
  });

  it("reports every problem at once instead of one at a time", () => {
    const { issues } = sanitizePreferences({
      ...base(),
      desiredRoles: [],
      preferredLocations: [],
      maxCommuteMinutes: 1,
    });
    expect(fields(issues)).toEqual(
      expect.arrayContaining(["desiredRoles", "preferredLocations", "maxCommuteMinutes"]),
    );
  });

  it("survives garbage input without throwing", () => {
    for (const junk of [null, undefined, 42, "nope", [], { desiredRoles: 5 }]) {
      const { data, issues } = sanitizePreferences(junk);
      expect(data).toBeNull();
      expect(issues.length).toBeGreaterThan(0);
    }
  });
});
