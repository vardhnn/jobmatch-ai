import { Panel } from "@/components/ui/panel";

/** Route-level skeleton — keeps navigation from flashing an empty page. */
export default function DashboardLoading() {
  return (
    <div className="fade-up flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl lg:text-[28px]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-ink-soft">Loading your matches…</p>
      </div>

      <Panel className="scanlines px-5 py-8">
        <div className="mono-label" style={{ color: "var(--term)" }}>
          FETCHING DASHBOARD<span className="cursor-blink">_</span>
        </div>
      </Panel>
    </div>
  );
}
