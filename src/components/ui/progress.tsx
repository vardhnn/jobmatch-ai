"use client";

/** Animated loading bar with a retro segmented look. */
export function RetroProgress({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-3 w-full overflow-hidden rounded-sm border border-line-strong bg-sunken">
      <div
        className="h-full transition-[width] duration-500 ease-out"
        style={{
          width: `${v}%`,
          backgroundColor: "var(--term)",
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0 6px, transparent 6px 12px)",
        }}
      />
    </div>
  );
}
