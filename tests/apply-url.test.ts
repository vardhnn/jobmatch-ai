import { describe, it, expect } from "vitest";
import { safeApplyUrl } from "../src/lib/apply-url";

/**
 * The apply link renders third-party URLs from job boards. These tests pin the
 * vetting rules: anything that is not plain http(s) must be rejected so it can
 * never become a click-to-execute link.
 */
describe("safeApplyUrl", () => {
  it("accepts https job links", () => {
    const result = safeApplyUrl("https://jobicy.com/jobs/151889-cloud-support-engineer-2");
    expect(result).not.toBeNull();
    expect(result?.href).toBe("https://jobicy.com/jobs/151889-cloud-support-engineer-2");
    expect(result?.host).toBe("jobicy.com");
  });

  it("accepts http (not only https)", () => {
    expect(safeApplyUrl("http://example.com/jobs/1")?.host).toBe("example.com");
  });

  it("strips a leading www. from the display host", () => {
    expect(safeApplyUrl("https://www.remotive.com/jobs/1")?.host).toBe("remotive.com");
  });

  it("preserves query strings and fragments", () => {
    const r = safeApplyUrl("https://boards.example.com/jobs/42?ref=adzuna#top");
    expect(r?.href).toContain("ref=adzuna");
    expect(r?.href).toContain("#top");
  });

  it("rejects javascript: URLs", () => {
    expect(safeApplyUrl("javascript:alert(document.cookie)")).toBeNull();
  });

  it("rejects javascript: with mixed case and whitespace", () => {
    expect(safeApplyUrl("  JaVaScRiPt:alert(1)  ")).toBeNull();
  });

  it("rejects data: URLs", () => {
    expect(safeApplyUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects file: and blob: URLs", () => {
    expect(safeApplyUrl("file:///etc/passwd")).toBeNull();
    expect(safeApplyUrl("blob:https://example.com/abc")).toBeNull();
  });

  it("rejects relative paths and bare hostnames", () => {
    // A bare "example.com/jobs" must not be silently treated as a relative URL.
    expect(safeApplyUrl("/jobs/1")).toBeNull();
    expect(safeApplyUrl("example.com/jobs")).toBeNull();
  });

  it("rejects empty, null and undefined", () => {
    expect(safeApplyUrl(null)).toBeNull();
    expect(safeApplyUrl(undefined)).toBeNull();
    expect(safeApplyUrl("")).toBeNull();
    expect(safeApplyUrl("   ")).toBeNull();
  });

  it("rejects malformed URLs that URL cannot parse", () => {
    expect(safeApplyUrl("http://")).toBeNull();
    expect(safeApplyUrl("https://[bad")).toBeNull();
  });
});
