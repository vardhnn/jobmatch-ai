/**
 * Regression tests for source date handling.
 *
 * The Himalayas API returns `pubDate` as Unix epoch **seconds in a number**.
 * Treating it as an ISO string silently dated every listing 1970-01-21, which
 * the freshness filter then discarded — an entire working source contributing
 * nothing while every health check looked green.
 */
import { describe, expect, it } from "vitest";

import { toPostedDate, matchesLocation } from "@/lib/sources/himalayas";

describe("himalayas · toPostedDate", () => {
  it("reads the real payload shape: epoch seconds as a number", () => {
    // Captured verbatim from https://himalayas.app/jobs/api
    expect(toPostedDate(1791095033)?.toISOString()).toBe(new Date(1791095033 * 1000).toISOString());
    expect(toPostedDate(1791095033)?.toISOString()).toBe("2026-10-04T06:23:53.000Z");
  });

  it("never produces an epoch date for a plausible epoch value", () => {
    const d = toPostedDate(1791095033)!;
    // The regression showed up as 1970-01-21; anything before ~2000 is wrong.
    expect(d.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("treats a bare numeric string as seconds too", () => {
    expect(toPostedDate("1791095033")?.toISOString()).toBe("2026-10-04T06:23:53.000Z");
  });

  it("leaves millisecond timestamps alone", () => {
    const ms = 1_791_095_033_000;
    expect(toPostedDate(ms)?.toISOString()).toBe(new Date(ms).toISOString());
  });

  it("parses ISO strings for feeds that send them", () => {
    expect(toPostedDate("2026-09-30T10:00:00Z")?.toISOString()).toBe("2026-09-30T10:00:00.000Z");
  });

  it("returns null rather than Invalid Date", () => {
    expect(toPostedDate(undefined)).toBeNull();
    expect(toPostedDate(null)).toBeNull();
    expect(toPostedDate("")).toBeNull();
    expect(toPostedDate("not a date")).toBeNull();
    expect(toPostedDate(0)).toBeNull();
    expect(toPostedDate(-5)).toBeNull();
    expect(toPostedDate(Number.NaN)).toBeNull();
  });
});

describe("himalayas · matchesLocation", () => {
  it("matches a listing restricted to the exact city", () => {
    expect(matchesLocation(["Hyderabad, Telangana, India"], "Hyderabad, Telangana, India")).toBe(true);
  });

  it("matches a country-wide listing for a city search", () => {
    // The regression: requiring the full string discarded "India" listings and
    // silently emptied the source for every Indian search.
    expect(matchesLocation(["India"], "Hyderabad, Telangana, India")).toBe(true);
  });

  it("matches a state-wide listing", () => {
    expect(matchesLocation(["Telangana, India"], "Hyderabad, Telangana, India")).toBe(true);
  });

  it("still rejects a genuinely unrelated location", () => {
    expect(matchesLocation(["United States"], "Hyderabad, Telangana, India")).toBe(false);
    expect(matchesLocation(["Germany, Europe"], "Pune, Maharashtra, India")).toBe(false);
  });

  it("treats an empty query or missing restrictions as a match", () => {
    expect(matchesLocation(undefined, "")).toBe(true);
    expect(matchesLocation([], "Bengaluru")).toBe(false);
    expect(matchesLocation(undefined, "")).toBe(true);
  });
});