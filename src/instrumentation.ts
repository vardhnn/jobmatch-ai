/**
 * Next.js instrumentation hook — runs once when the Node.js server boots.
 *
 * Registers the daily search job (SEARCH_CRON, e.g. "0 7 * * *") so searches
 * happen without the user opening the app. Idempotent: guarded on globalThis
 * so dev hot-reloads don't stack timers.
 */

const SCHEDULE_FLAG = "__jobmatch_cron_registered";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The edge sandbox has no node-cron and no DB — never schedule there.
  if ("EdgeRuntime" in globalThis) return;
  if (process.env.DISABLE_CRON === "1") return;

  const g = globalThis as unknown as Record<string, unknown>;
  if (g[SCHEDULE_FLAG]) return;

  try {
    const [{ default: cron }, { runSearchForUser }, { prisma }, { config }] = await Promise.all([
      import("node-cron"),
      import("@/lib/services/search-service"),
      import("@/lib/db").then((m) => ({ prisma: m.prisma })),
      import("@/lib/config").then((m) => ({ config: m.config })),
    ]);

    if (!cron.validate(config.schedule.cron)) {
      console.error(`[cron] invalid SEARCH_CRON "${config.schedule.cron}" — scheduler disabled`);
      return;
    }

    cron.schedule(
      config.schedule.cron,
      async () => {
        const started = Date.now();
        console.log(`[cron] daily search started (${config.schedule.cron} ${config.schedule.timezone})`);
        try {
          const users = await prisma.user.findMany({ select: { id: true, email: true } });
          for (const user of users) {
            try {
              // BYOK: keys live in each user's browser, so scheduled runs have
              // no credential — they fetch/store jobs only; matching happens
              // on the next user-triggered search (orphan-analysis path).
              const summary = await runSearchForUser(user.id, "SCHEDULED", null);
              console.log(
                `[cron] ${user.email}: ${summary.newJobs} new, ${summary.strongMatches} strong, ${summary.potentialMatches} potential`,
              );
            } catch (err) {
              console.error(`[cron] ${user.email} failed:`, err);
            }
          }
        } finally {
          console.log(`[cron] daily search finished in ${Math.round((Date.now() - started) / 1000)}s`);
        }
      },
      { timezone: config.schedule.timezone },
    );

    g[SCHEDULE_FLAG] = true;
    console.log(`[cron] scheduled "${config.schedule.cron}" (${config.schedule.timezone})`);
  } catch (err) {
    console.error("[cron] scheduler failed to start:", err);
  }
}
