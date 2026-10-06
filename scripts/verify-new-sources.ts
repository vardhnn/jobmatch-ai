/**
 * Live smoke test for the two new sources.
 *
 * Run: npx tsx scripts/verify-new-sources.ts
 *
 * The unit tests prove the parsers; this proves the adapters still work
 * against the real endpoints today, including the failure paths.
 */
import "./load-env";

import { fetchFromSource } from "../src/lib/sources";

async function main() {
  console.log("\n=== LIVE ADAPTER SMOKE TEST ===\n");

  const cases: { key: string; text: string; location: string | null }[] = [
    { key: "linkedin", text: "backend engineer", location: "Bengaluru, Karnataka, India" },
    { key: "linkedin", text: "data scientist", location: "Pune, Maharashtra, India" },
    { key: "linkedin", text: "platform engineer", location: null },
    { key: "ats", text: "backend", location: "Bengaluru, India" },
    { key: "ats", text: "software", location: null },
  ];

  let failures = 0;

  for (const c of cases) {
    const started = Date.now();
    const { jobs, error, warning } = await fetchFromSource(c.key, {
      text: c.text,
      location: c.location,
    });
    const ms = Date.now() - started;
    const label = `${c.key}:${c.text}${c.location ? `@${c.location.split(",")[0]}` : ""}`.padEnd(40);

    if (error) {
      // A hard error is only acceptable for LinkedIn (it may throttle us) —
      // the ATS source should degrade quietly instead.
      console.log(`${label} ERROR ${error.code}: ${error.message} (${ms}ms)`);
      if (c.key === "ats") failures++;
      continue;
    }

    const withLinks = jobs.filter((j) => j.applicationUrl).length;
    const withSalary = jobs.filter((j) => j.salaryOriginal).length;
    const dated = jobs.filter((j) => j.postedDate).length;
    console.log(
      `${label} ${String(jobs.length).padStart(3)} jobs · ${ms}ms · links=${withLinks} dated=${dated} salary=${withSalary}` +
        (warning ? `\n${" ".repeat(44)}⚠ ${warning.slice(0, 110)}` : ""),
    );
    if (jobs.length === 0) failures++;

    for (const j of jobs.slice(0, 2)) {
      console.log(
        `${" ".repeat(6)}· ${j.title.slice(0, 52).padEnd(52)} @ ${j.company.slice(0, 22).padEnd(22)} ${(j.location ?? "—").slice(0, 30)}`,
      );
      if (j.applicationUrl) console.log(`${" ".repeat(8)}${j.applicationUrl.slice(0, 88)}`);
    }
    console.log("");
  }

  console.log(failures === 0 ? "RESULT: all cases returned data.\n" : `RESULT: ${failures} case(s) returned nothing.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});