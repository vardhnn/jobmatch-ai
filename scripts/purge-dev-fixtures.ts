/**
 * Purge the development-fixture jobs now that the adapter is removed.
 *
 * The adapter is gone from the registry, but its rows survive: the source-row
 * prune deliberately keeps any row that still owns postings, so without this
 * the fake example.com jobs would keep ranking on the dashboard forever.
 *
 * Deletes only jobs whose every source record belongs to the development
 * fixture source — a job also found by a real board is left alone.
 *
 * Run: npx tsx scripts/purge-dev-fixtures.ts
 *      npx tsx scripts/purge-dev-fixtures.ts --dry-run
 */
import "./load-env";

import { prisma } from "../src/lib/db";

const DRY = process.argv.includes("--dry-run");

async function main() {
  const sources = await prisma.jobSource.findMany({
    where: { key: "development" },
    select: { id: true, userId: true },
  });
  console.log(`\ndevelopment source rows: ${sources.length}`);
  if (!sources.length) {
    console.log("nothing to purge\n");
    return;
  }

  const sourceIds = sources.map((s) => s.id);
  const records = await prisma.jobSourceRecord.findMany({
    where: { sourceId: { in: sourceIds } },
    select: { id: true, jobId: true, sourceId: true, title: true, company: true },
  });
  console.log(`job records behind them: ${records.length}`);

  // A job is fixture-only when it has no record from any other source.
  const fixtureJobIds = new Set(
    records.map((r) => r.jobId).filter((id): id is string => Boolean(id)),
  );
  const shared = new Set<string>();
  for (const jobId of fixtureJobIds) {
    const elsewhere = await prisma.jobSourceRecord.count({
      where: { jobId, sourceId: { notIn: sourceIds } },
    });
    if (elsewhere > 0) shared.add(jobId);
  }
  const exclusive = [...fixtureJobIds].filter((id) => !shared.has(id));

  console.log(`fixture jobs: ${fixtureJobIds.size}`);
  console.log(`  also found by a real board (kept): ${shared.size}`);
  console.log(`  fixture-only (removed): ${exclusive.length}`);

  const matches = await prisma.jobMatch.count({ where: { jobId: { in: exclusive } } });
  const analyses = await prisma.jobAnalysis.count({ where: { jobId: { in: exclusive } } });
  console.log(`  matching JobMatch rows: ${matches} · JobAnalysis rows: ${analyses}`);

  if (DRY) {
    console.log("\n--dry-run: nothing deleted.\n");
    return;
  }

  // Matches/analyses cascade from Job; records are removed explicitly.
  await prisma.jobSourceRecord.deleteMany({ where: { jobId: { in: exclusive } } });
  const deleted = await prisma.job.deleteMany({ where: { id: { in: exclusive } } });
  const rows = await prisma.jobSource.deleteMany({ where: { id: { in: sourceIds } } });
  console.log(`\ndeleted ${deleted.count} jobs, ${rows.count} source rows.`);
  console.log("Remaining example.com jobs:",
    await prisma.jobSourceRecord.count({ where: { applicationUrl: { contains: "example.com" } } }));
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());