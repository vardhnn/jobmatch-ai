import { describe, it, expect } from "vitest";
import { stripHtml, inferArrangement, toInt } from "@/lib/sources/types";
import { dedupeKeyFor } from "@/lib/services/dedupe";
import { scoreAnswerToHundred } from "@/lib/ai/openrouter-client";

/**
 * Pure-logic tests for the source adapters' shared normalization and for the
 * mapping from JEV probability answers to 0–100 sub-scores.
 */

describe("source normalization helpers", () => {
  it("strips markup and collapses whitespace", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p><script>x()</script>")).toBe("Hello world");
  });

  it("returns null for empty descriptions", () => {
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml("   ")).toBeNull();
  });

  it("truncates very long descriptions", () => {
    expect(stripHtml("<p>" + "a".repeat(10_000) + "</p>", 100)).toHaveLength(100);
  });

  it("infers work arrangement from location text", () => {
    expect(inferArrangement("Remote (India)")).toBe("REMOTE");
    expect(inferArrangement("Bengaluru, India", "hybrid")).toBe("HYBRID");
    expect(inferArrangement("Berlin, Germany")).toBe("ONSITE");
    expect(inferArrangement(null)).toBe("UNKNOWN");
  });

  it("parses salary numbers and rejects junk", () => {
    expect(toInt("120,000")).toBe(120000);
    expect(toInt(95000)).toBe(95000);
    expect(toInt("n/a")).toBeNull();
    expect(toInt(-5)).toBeNull();
  });
});

describe("dedupeKeyFor", () => {
  it("collapses the same posting across boards by URL", () => {
    const a = dedupeKeyFor({
      title: "Backend Engineer",
      company: "Acme",
      applicationUrl: "https://jobs.acme.com/42?utm_source=x",
    });
    const b = dedupeKeyFor({
      title: "Backend Engineer (Remote)",
      company: "Acme",
      applicationUrl: "https://jobs.acme.com/42/",
    });
    expect(a).toBe(b);
  });

  it("falls back to title+company when no URL is present", () => {
    const a = dedupeKeyFor({ title: "Data Analyst", company: "Globex", applicationUrl: null });
    const b = dedupeKeyFor({ title: "data   analyst", company: "GLOBEX", applicationUrl: null });
    const c = dedupeKeyFor({ title: "Data Scientist", company: "Globex", applicationUrl: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("does not collide between url-keyed and title-keyed jobs", () => {
    const withUrl = dedupeKeyFor({ title: "X", company: "Y", applicationUrl: "https://y.dev/x" });
    const without = dedupeKeyFor({ title: "X", company: "Y", applicationUrl: null });
    expect(withUrl).not.toBe(without);
  });
});

describe("scoreAnswerToHundred", () => {
  it("uses the probability distribution when present", () => {
    const score = scoreAnswerToHundred(
      { type: "score", probabilities: { "0": 0, "1": 0, "2": 0, "3": 1, "4": 0 }, score: 3 },
      5,
    );
    expect(score).toBe(75);
  });

  it("averages spread distributions", () => {
    // Half "no fit" (index 0), half "exact fit" (index 4) → 50.
    const score = scoreAnswerToHundred(
      { type: "score", probabilities: { "0": 0.5, "4": 0.5 }, score: 2 },
      5,
    );
    expect(score).toBe(50);
  });

  it("falls back to the raw score index", () => {
    expect(scoreAnswerToHundred({ type: "score", score: 4 }, 5)).toBe(100);
    expect(scoreAnswerToHundred({ type: "score", score: 2 }, 5)).toBe(50);
  });

  it("clamps out-of-range indexes", () => {
    expect(scoreAnswerToHundred({ type: "score", score: 9 }, 5)).toBe(100);
    expect(scoreAnswerToHundred({ type: "score", score: -3 }, 5)).toBe(0);
  });

  it("returns null when the answer is missing or unusable", () => {
    expect(scoreAnswerToHundred(undefined, 5)).toBeNull();
    expect(scoreAnswerToHundred({ type: "choice", choice: "STRONG" }, 5)).toBeNull();
  });
});
