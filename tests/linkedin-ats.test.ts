/**
 * Parser tests for the two new sources.
 *
 * Everything here runs offline against markup/payloads captured from the live
 * endpoints, so the fragile part — the parsing — is verified without making a
 * single network call in CI.
 */
import { describe, expect, it } from "vitest";

import {
  looksBlocked,
  parseLinkedInCards,
  parseRelativeDate,
} from "@/lib/sources/linkedin";
import {
  normalizeAshby,
  normalizeLever,
  normalizeSmartRecruiters,
  type AtsBoard,
} from "@/lib/sources/ats";

/** Trimmed from a real `seeMoreJobPostings` response. */
const REAL_LI = `
<li>
  <div class="base-card relative w-full base-search-card" data-entity-urn="urn:li:jobPosting:4455303752" data-column="1">
    <a class="base-card__full-link absolute" href="https://in.linkedin.com/jobs/view/back-end-software-engineer-core-java-at-light-wonder-4455303752?position=1&amp;refId=abc" data-tracking-control-name="public_jobs_jserp-result_search-card">
      <span class="sr-only">Back-End Software Engineer - Core Java</span>
    </a>
    <div class="search-entity-media">
      <img data-delayed-url="https://media.licdn.com/x" alt>
    </div>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">Back-End Software Engineer - Core Java</h3>
      <h4 class="base-search-card__subtitle">Light &amp; Wonder</h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">Bengaluru, Karnataka, India</span>
        <time class="job-search-card__listdate" datetime="2026-09-29">2 days ago</time>
      </div>
    </div>
  </div>
</li>
<li>
  <div class="base-search-card" data-entity-urn="urn:li:jobPosting:4461487136">
    <a class="base-card__full-link" href="https://in.linkedin.com/jobs/view/x-4461487136"></a>
    <h3 class="base-search-card__title">SDE III</h3>
    <h4 class="base-search-card__subtitle">Eltropy</h4>
    <span class="job-search-card__location">Remote</span>
    <time>1 week ago</time>
  </div>
</li>
<li>
  <div data-entity-urn="urn:li:jobPosting:999">
    <h3 class="base-search-card__title">No company heading</h3>
  </div>
</li>
`;

describe("linkedin · parseLinkedInCards", () => {
  it("extracts id, title, company and location from real card markup", () => {
    const cards = parseLinkedInCards(REAL_LI);
    expect(cards).toHaveLength(2);

    expect(cards[0].sourceJobId).toBe("4455303752");
    expect(cards[0].title).toBe("Back-End Software Engineer - Core Java");
    // Entity-escaped ampersand must be decoded, not kept as `&amp;`.
    expect(cards[0].company).toBe("Light & Wonder");
    expect(cards[0].location).toBe("Bengaluru, Karnataka, India");
  });

  it("builds a canonical, tracking-free apply URL from the job id", () => {
    const [first] = parseLinkedInCards(REAL_LI);
    expect(first.applicationUrl).toBe("https://www.linkedin.com/jobs/view/4455303752");
    // The scraped href carries position/refId tracking — it must not leak out.
    expect(first.applicationUrl).not.toContain("refId");
  });

  it("drops cards missing a company rather than emitting half-populated jobs", () => {
    const cards = parseLinkedInCards(REAL_LI);
    expect(cards.map((c) => c.title)).not.toContain("No company heading");
  });

  it("decodes entities and collapses whitespace in titles", () => {
    const html = `<li><div data-entity-urn="urn:li:jobPosting:1">
      <h3 class="base-search-card__title">  R&amp;D
      Lead  </h3>
      <h4 class="base-search-card__subtitle">Acme</h4></div></li>`;
    expect(parseLinkedInCards(html)[0].title).toBe("R&D Lead");
  });

  it("prefers the datetime attribute over the human-readable age", () => {
    const card = parseLinkedInCards(REAL_LI)[0];
    const expected = new Date("2026-09-29");
    expect(card.postedDate?.toISOString()).toBe(expected.toISOString());
  });

  it("returns nothing for a challenge page instead of fake jobs", () => {
    const captcha = `<html><body>Verify you are human<input class="px-captcha"></body></html>`;
    expect(looksBlocked(captcha)).toBe(true);
    expect(parseLinkedInCards(captcha)).toEqual([]);
  });

  it("treats a tiny shell response as blocked", () => {
    expect(looksBlocked("<html></html>")).toBe(true);
    expect(looksBlocked(REAL_LI)).toBe(false);
  });

  it("returns an empty list when there are no cards", () => {
    expect(parseLinkedInCards("<ul></ul>")).toEqual([]);
  });
});

describe("linkedin · parseRelativeDate", () => {
  const approx = (days: number) => {
    const got = parseRelativeDate(days === 0 ? "today" : `${days} days ago`)!;
    const diff = Math.abs(Date.now() - got.getTime()) / 86_400_000;
    expect(diff).toBeGreaterThan(days - 0.2);
    expect(diff).toBeLessThan(days + 0.2);
  };

  it("understands the ages LinkedIn actually renders", () => {
    approx(2);
    approx(7);
    expect(parseRelativeDate("today")).toBeInstanceOf(Date);
    expect(parseRelativeDate("yesterday")).toBeInstanceOf(Date);
    expect(parseRelativeDate("3 weeks ago")).toBeInstanceOf(Date);
    expect(parseRelativeDate("6 months ago")).toBeInstanceOf(Date);
    expect(parseRelativeDate("1 hour ago")).toBeInstanceOf(Date);
  });

  it("returns null rather than inventing a date for unknown wording", () => {
    expect(parseRelativeDate("sometime soon")).toBeNull();
    expect(parseRelativeDate(null)).toBeNull();
    expect(parseRelativeDate("")).toBeNull();
  });
});

/* ── ATS normalizers ─────────────────────────────────────────────────────── */

const board: AtsBoard = { provider: "ashby", company: "notion", display: "Notion" };

describe("ats · normalizeAshby", () => {
  const payload = {
    jobs: [
      {
        id: "1fc309c8",
        title: "Senior Backend Engineer",
        location: "San Francisco",
        workplaceType: "Remote",
        employmentType: "FullTime",
        publishedDate: "2026-09-30T10:00:00Z",
        applyUrl: "https://jobs.ashbyhq.com/notion/1fc309c8/application",
        descriptionPlain: "Build things.",
        department: "Engineering",
        team: "Core",
        secondaryLocations: [{ location: "London" }, { location: "Remote - EU" }],
      },
    ],
  };

  it("maps a posting and keeps every secondary location", () => {
    const [job] = normalizeAshby(payload, board);
    expect(job.sourceJobId).toBe("ashby:notion:1fc309c8");
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.location).toContain("San Francisco");
    expect(job.location).toContain("London");
    expect(job.location).toContain("Remote - EU");
  });

  it("reads a declared Remote workplace as REMOTE", () => {
    expect(normalizeAshby(payload, board)[0].workArrangement).toBe("REMOTE");
  });

  it("normalizes the CamelCase employment enum to readable text", () => {
    expect(normalizeAshby(payload, board)[0].employmentType).toBe("Full-time");
  });

  it("treats an employer-hosted board as a direct apply", () => {
    const [job] = normalizeAshby(payload, board);
    expect(job.directApply).toBe(true);
    expect(job.applicationUrl).toContain("ashbyhq.com");
  });

  it("skips records missing an id or title", () => {
    expect(normalizeAshby({ jobs: [{ title: "No id" }, { id: "x" }] }, board)).toEqual([]);
  });

  it("returns an empty list for a malformed payload", () => {
    expect(normalizeAshby(null, board)).toEqual([]);
    expect(normalizeAshby({}, board)).toEqual([]);
  });
});

describe("ats · normalizeLever", () => {
  const payload = [
    {
      id: "abc-123",
      text: "Backend Engineer",
      hostedUrl: "https://jobs.lever.co/meesho/abc-123",
      applyUrl: "https://jobs.lever.co/meesho/abc-123/apply",
      descriptionPlain: "Do backend work.",
      createdAt: 1_757_000_000_000,
      workplaceType: "hybrid",
      categories: {
        team: "Engineering",
        location: "Bangalore",
        commitment: "Full-time",
        allLocations: ["Bangalore", "Delhi NCR"],
      },
    },
  ];

  it("maps a posting and de-duplicates the primary location from allLocations", () => {
    const [job] = normalizeLever(payload, { provider: "lever", company: "meesho", display: "Meesho" });
    expect(job.sourceJobId).toBe("lever:meesho:abc-123");
    expect(job.company).toBe("Meesho");
    // "Bangalore" appears in both fields — it must not be listed twice.
    expect(job.location?.match(/Bangalore/g)).toHaveLength(1);
    expect(job.location).toContain("Delhi NCR");
  });

  it("maps the hybrid workplace type", () => {
    const [job] = normalizeLever(payload, { provider: "lever", company: "meesho" });
    expect(job.workArrangement).toBe("HYBRID");
    expect(job.employmentType).toBe("Full-time");
  });

  it("converts Lever's epoch-milliseconds createdAt", () => {
    const [job] = normalizeLever(payload, { provider: "lever", company: "meesho" });
    expect(job.postedDate?.toISOString()).toBe(new Date(1_757_000_000_000).toISOString());
  });

  it("prefers the apply URL over the hosted page", () => {
    const [job] = normalizeLever(payload, { provider: "lever", company: "meesho" });
    expect(job.applicationUrl).toBe("https://jobs.lever.co/meesho/abc-123/apply");
  });

  it("survives a non-array payload", () => {
    expect(normalizeLever({ error: "not found" }, { provider: "lever", company: "x" })).toEqual([]);
  });
});

describe("ats · normalizeSmartRecruiters", () => {
  const payload = {
    content: [
      {
        id: "6000000001459252",
        uuid: "6f30edfa-5414-4aea-a193-e0ff0e87921e",
        name: "Account Manager",
        company: { name: "SWIGGY", identifier: "SWIGGY" },
        releasedDate: "2026-10-03T11:08:36.851Z",
        location: { city: "Goa", country: "in", remote: false, hybrid: false, fullLocation: "Goa, , India" },
        typeOfEmployment: { label: "Full-time" },
        experienceLevel: { label: "Not Applicable" },
        department: { label: "Sales" },
        customField: [
          { fieldLabel: "Job Family", valueLabel: "Sales" },
          { fieldLabel: "Team", valueLabel: "Supply - Retail" },
        ],
      },
    ],
  };
  const srBoard: AtsBoard = { provider: "smartrecruiters", company: "Swiggy", display: "Swiggy" };

  it("maps a posting and tidies the stray comma in fullLocation", () => {
    const [job] = normalizeSmartRecruiters(payload, srBoard);
    expect(job.sourceJobId).toBe("smartrecruiters:Swiggy:6f30edfa-5414-4aea-a193-e0ff0e87921e");
    // Real payload ships "Goa, , India".
    expect(job.location).toBe("Goa, India");
  });

  it("never fabricates an apply URL it was not given", () => {
    const [job] = normalizeSmartRecruiters(payload, srBoard);
    expect(job.applicationUrl).toBeNull();
    expect(job.directApply).toBe(false);
  });

  it("honours the remote flag over inference from the location text", () => {
    const remote = {
      content: [{ ...payload.content[0], location: { city: "Goa", remote: true, fullLocation: "Goa, India" } }],
    };
    expect(normalizeSmartRecruiters(remote, srBoard)[0].workArrangement).toBe("REMOTE");
  });

  it("collects custom field values as skill/team tags", () => {
    const [job] = normalizeSmartRecruiters(payload, srBoard);
    expect(job.tags).toContain("Supply - Retail");
    expect(job.tags).toContain("Sales");
  });

  it("skips records with no usable identifier", () => {
    expect(normalizeSmartRecruiters({ content: [{ name: "Ghost" }] }, srBoard)).toEqual([]);
  });
});