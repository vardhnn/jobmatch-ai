"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RetroButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/states";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint = mode === "signin" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "signin" ? { email, password } : { email, password, name: name || undefined },
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Something went wrong. Please try again.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Network failure — could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mono-label mb-2">JOBMATCH_AI</div>
          <div
            className="mx-auto mb-4 h-px w-16"
            style={{ backgroundColor: "var(--line-strong)" }}
          />
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">Your personal AI job hunter.</p>
        </div>

        <div className="rounded-card border border-line bg-panel p-6 shadow-[0_1px_2px_rgba(28,27,24,0.06)]">
          {error ? (
            <div className="mb-4">
              <ErrorBanner title={mode === "signin" ? "SIGN-IN FAILED" : "REGISTRATION FAILED"}>
                {error}
              </ErrorBanner>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {mode === "signup" ? (
              <label className="flex flex-col gap-1.5">
                <span className="mono-label">NAME (OPTIONAL)</span>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 rounded-control border border-line-strong bg-sunken px-3 text-sm outline-none focus:border-term"
                  placeholder="Your name"
                />
              </label>
            ) : null}

            <label className="flex flex-col gap-1.5">
              <span className="mono-label">EMAIL</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 rounded-control border border-line-strong bg-sunken px-3 text-sm outline-none focus:border-term"
                placeholder="you@example.com"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="mono-label">
                {mode === "signup" ? "PASSWORD (MIN 8 CHARS)" : "PASSWORD"}
              </span>
              <input
                type="password"
                required
                minLength={mode === "signup" ? 8 : 1}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-control border border-line-strong bg-sunken px-3 text-sm outline-none focus:border-term"
                placeholder="••••••••"
              />
            </label>

            <RetroButton type="submit" variant="primary" size="lg" disabled={busy}>
              {busy
                ? mode === "signin"
                  ? "AUTHENTICATING..."
                  : "CREATING..."
                : mode === "signin"
                  ? "ENTER →"
                  : "CREATE ACCOUNT →"}
            </RetroButton>
          </form>

          <div className="mt-4 border-t border-line pt-4 text-center">
            <button
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
              className="mono-label hover:text-ink"
            >
              {mode === "signin" ? "NO ACCOUNT? CREATE ONE →" : "HAVE AN ACCOUNT? SIGN IN →"}
            </button>
          </div>
        </div>

        <p className="mono-label mt-6 text-center">
          SMART SEARCH · INTELLIGENT MATCHING · DAILY DISCOVERY
        </p>
      </div>
    </main>
  );
}
