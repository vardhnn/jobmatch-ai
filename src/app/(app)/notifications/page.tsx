"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { RetroButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner } from "@/components/ui/states";

type Notification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) {
      setError("Could not load notifications.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setItems(data.notifications ?? []);
    setUnread(data.unread ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        setError("Could not load notifications.");
        setLoading(false);
      }
    })();
  }, [load]);

  async function markAllRead() {
    const res = await fetch("/api/notifications", { method: "PATCH" });
    if (res.ok) await load();
  }

  return (
    <div className="fade-up flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Daily search summaries and source problems. The scheduled run writes one of these every morning."
        actions={
          <>
            {unread > 0 ? (
              <StatusBadge tone="amber" pulse>
                {unread} UNREAD
              </StatusBadge>
            ) : null}
            <RetroButton onClick={markAllRead} disabled={unread === 0}>
              MARK ALL READ
            </RetroButton>
          </>
        }
      />

      {error ? <ErrorBanner title="NOTIFICATIONS ERROR">{error}</ErrorBanner> : null}

      {loading ? (
        <Panel className="scanlines px-5 py-8">
          <div className="mono-label" style={{ color: "var(--term)" }}>
            LOADING<span className="cursor-blink">_</span>
          </div>
        </Panel>
      ) : items.length === 0 ? (
        <EmptyState
          code="NO NOTIFICATIONS"
          title="Nothing here yet"
          body="Run a search and its summary will land here."
        >
          <Link href="/sources">
            <RetroButton variant="primary">OPEN SOURCES</RetroButton>
          </Link>
        </EmptyState>
      ) : (
        <Panel className="divide-y divide-line">
          {items.map((n) => (
            <div key={n.id} className="flex gap-3 px-5 py-4">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: n.read ? "var(--line-strong)" : "var(--term)" }}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${n.read ? "text-ink-soft" : "font-semibold text-ink"}`}>
                    {n.title}
                  </span>
                  {n.kind === "SOURCE_ERROR" ? <StatusBadge tone="red">ERROR</StatusBadge> : null}
                  <span className="mono-label">{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>
              </div>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
