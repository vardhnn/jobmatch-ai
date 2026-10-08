"use client";

/**
 * Client-side BYOK key vault.
 *
 * API keys never touch the server's storage: profiles live in this browser's
 * localStorage, and the active profile travels to the server per request in
 * the `X-AI-Credential` header. Clearing browser data deletes the keys.
 *
 * All functions are window-guarded so importing them from server components
 * or during SSR is safe (they simply no-op).
 */

import {
  PROVIDER_PRESETS,
  getPreset,
  validateCredential,
  type AiCredential,
  type ProviderId,
} from "@/lib/ai/providers";

export type AiProfile = {
  id: string;
  label: string;
  provider: ProviderId;
  model: string;
  baseUrl?: string | null;
  apiKey: string;
  createdAt: string;
};

const PROFILES_KEY = "jm_ai_profiles";
const ACTIVE_KEY = "jm_ai_active";

/** Presets safe to render in the UI (internal pseudo-providers excluded). */
export const UI_PROVIDER_PRESETS = PROVIDER_PRESETS.filter((p) => !p.internal);

export { getPreset, validateCredential };

function readProfiles(): AiProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is AiProfile =>
        !!p &&
        typeof p === "object" &&
        typeof (p as AiProfile).id === "string" &&
        typeof (p as AiProfile).provider === "string",
    );
  } catch {
    return [];
  }
}

function writeProfiles(profiles: AiProfile[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // private mode — profiles persist only for this session's React state
  }
}

export function listProfiles(): AiProfile[] {
  return readProfiles();
}

export function getActiveProfile(): AiProfile | null {
  const profiles = readProfiles();
  if (!profiles.length) return null;
  const activeId = typeof window === "undefined" ? null : window.localStorage.getItem(ACTIVE_KEY);
  return profiles.find((p) => p.id === activeId) ?? profiles[0];
}

export function saveProfile(input: Omit<AiProfile, "id" | "createdAt"> & { id?: string }): AiProfile {
  const profiles = readProfiles();
  const now = new Date().toISOString();
  const existing = input.id ? profiles.find((p) => p.id === input.id) : undefined;

  if (existing) {
    const updated: AiProfile = { ...existing, ...input, id: existing.id };
    writeProfiles(profiles.map((p) => (p.id === existing.id ? updated : p)));
    return updated;
  }

  const profile: AiProfile = {
    ...input,
    id: `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };
  writeProfiles([...profiles, profile]);
  // First profile becomes active automatically.
  if (!window.localStorage.getItem(ACTIVE_KEY)) {
    window.localStorage.setItem(ACTIVE_KEY, profile.id);
  }
  return profile;
}

export function deleteProfile(id: string) {
  const profiles = readProfiles().filter((p) => p.id !== id);
  writeProfiles(profiles);
  if (typeof window !== "undefined" && window.localStorage.getItem(ACTIVE_KEY) === id) {
    window.localStorage.removeItem(ACTIVE_KEY);
  }
}

export function setActiveProfile(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_KEY, id);
}

/** The active profile as the server sees it. */
export function activeCredential(): AiCredential | null {
  const p = getActiveProfile();
  if (!p) return null;
  return {
    provider: p.provider,
    apiKey: p.apiKey,
    model: p.model,
    baseUrl: p.baseUrl ?? null,
  };
}

/**
 * Value for the `X-AI-Credential` header, or null when no usable profile is
 * active. Callers set it as: `headers["X-AI-Credential"] = buildCredentialHeader()`.
 */
export function buildCredentialHeader(): string | null {
  const credential = activeCredential();
  if (!credential) return null;
  if (validateCredential(credential) !== null) return null;
  try {
    const json = JSON.stringify(credential);
    // btoa with UTF-8 safety.
    return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  } catch {
    return null;
  }
}

/** Fetch wrapper that attaches the credential header when a key is active. */
export async function aiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const header = buildCredentialHeader();
  const headers = new Headers(init.headers);
  if (header) headers.set("X-AI-Credential", header);
  return fetch(url, { ...init, headers });
}
