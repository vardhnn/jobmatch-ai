/**
 * Probe: can these portals be read server-side with a plain HTTP fetch?
 *
 * Run: npx tsx scripts/probe-portals.ts
 *
 * This exists to answer a question with evidence rather than folklore: before
 * building (or refusing to build) a scraper, find out what actually happens.
 */
import "./load-env";

type Probe = {
  name: string;
  url: string;
  headers?: Record<string, string>;
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PROBES: Probe[] = [
  {
    name: "linkedin /jobs-guest",
    url: "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=backend%20engineer&location=Bangalore",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  },
  {
    name: "linkedin /jobs-search",
    url: "https://www.linkedin.com/jobs/search?keywords=backend%20engineer&location=Bangalore",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  },
  {
    name: "indeed /jobs",
    url: "https://in.indeed.com/jobs?q=backend+engineer&l=Bangalore",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  },
  {
    name: "indeed /api",
    url: "https://in.indeed.com/api/v1/search?q=backend+engineer",
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
  },
  {
    name: "naukri /search",
    url: "https://www.naukri.com/jobsearch?keywords=backend%20engineer&location=bangalore",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html", Referer: "https://www.naukri.com/" },
  },
  {
    name: "naukri /api-gateway",
    url: "https://www.naukri.com/gateway/api/jobSearch/v1?searchType=adv&keyword=backend%20engineer&location=bangalore&pageNo=1",
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
      "appid": "109",
      "systemid": "109",
    },
  },
  {
    name: "glassdoor (bonus)",
    url: "https://www.glassdoor.co.in/Job/bangalore-backend-engineer-jobs-SRCH_II_KO0,17_IN60.htm",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  },
];

/** Signals that a response is a block/challenge page rather than content. */
const BLOCK_MARKERS = [
  "captcha",
  "are you a robot",
  "unusual traffic",
  "access denied",
  "security check",
  "enable javascript and cookies",
  "blocked",
  "forbidden",
  "enablecookies",
  "px-captcha",
  "datadome",
];

async function probe(p: Probe) {
  const started = Date.now();
  try {
    const res = await fetch(p.url, {
      headers: p.headers ?? { "User-Agent": BROWSER_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    const lower = body.toLowerCase();
    const markers = BLOCK_MARKERS.filter((m) => lower.includes(m));
    const bytes = Buffer.byteLength(body, "utf8");
    return {
      name: p.name,
      status: res.status,
      ms: Date.now() - started,
      kb: Math.round(bytes / 1024),
      type: res.headers.get("content-type")?.split(";")[0] ?? "-",
      markers,
      // A 200 that returns a challenge page is still a block.
      verdict:
        res.status !== 200
          ? "BLOCKED (http)"
          : markers.length
            ? "BLOCKED (challenge page)"
            : bytes < 2000
              ? "SUSPECT (too small)"
              : "READABLE",
    };
  } catch (err) {
    return {
      name: p.name,
      status: "ERR",
      ms: Date.now() - started,
      kb: 0,
      type: "-",
      markers: [],
      verdict: `ERROR ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`,
    };
  }
}

async function main() {
  console.log("\n=== SERVER-SIDE FETCHABILITY ===\n");
  const results = [];
  // Sequential: parallel bursts trip bot detection and pollute the result.
  for (const p of PROBES) {
    const r = await probe(p);
    results.push(r);
    console.log(
      `${r.name.padEnd(24)} status=${String(r.status).padEnd(4)} ${String(r.kb).padStart(5)}kb ${String(r.ms).padStart(6)}ms  ${r.verdict}`,
    );
    if (r.markers.length) console.log(`${"".padEnd(24)} markers: ${r.markers.join(", ")}`);
    await new Promise((res) => setTimeout(res, 1200));
  }

  const readable = results.filter((r) => r.verdict === "READABLE");
  console.log(
    `\n${readable.length}/${results.length} readable without a browser or official API.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});