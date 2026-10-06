import { Panel } from "@/components/ui/panel";

/** Route-level skeleton for the ranked job list. */
export default function JobsLoading() {
  return (
    <div className="fade-up flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl lg:text-[28px]">Jobs</h1>
        <p className="mt-1 text-sm text-ink-soft">Ranking your matches…</p>
      </div>

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Panel key={i} className="h-32 animate-pulse px-5 py-4">
            <span className="sr-only">Loading job {i + 1}</span>
          </Panel>
        ))}
      </div>
    </div>
  );
}
