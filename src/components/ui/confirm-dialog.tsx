"use client";

import { useEffect } from "react";
import { RetroButton } from "./button";

/**
 * Retro confirmation dialog. Used for irreversible actions (logout, clearing
 * data). Focus is trapped to the two buttons and Escape cancels.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "CONFIRM",
  cancelLabel = "CANCEL",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "color-mix(in srgb, var(--ink) 45%, transparent)" }}
        onClick={busy ? undefined : onCancel}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="fade-up relative w-full max-w-sm rounded-card border border-line-strong bg-panel p-5 shadow-[0_10px_40px_rgba(0,0,0,0.25)]"
      >
        <div className="mono-label mb-1.5">── CONFIRM ──</div>
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <RetroButton variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </RetroButton>
          <RetroButton
            autoFocus
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "WORKING..." : confirmLabel}
          </RetroButton>
        </div>
      </div>
    </div>
  );
}
