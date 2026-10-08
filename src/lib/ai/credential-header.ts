"use server-only";

/**
 * Client → server credential transport.
 *
 * The browser keeps BYOK profiles in localStorage and sends the active one on
 * AI-touching requests as `X-AI-Credential: base64(JSON)`. This module is the
 * single reader of that header: it validates strictly and returns null on
 * anything absent/malformed/disallowed — callers treat null as "no key".
 *
 * The internal `heuristic` provider is rejected here so a client can never
 * select the offline engine over HTTP.
 */

import { validateCredential, getPreset, type AiCredential } from "./providers";

export const AI_CREDENTIAL_HEADER = "x-ai-credential";

export function parseAiCredential(req: Request): AiCredential | null {
  const raw = req.headers.get(AI_CREDENTIAL_HEADER);
  if (!raw) return null;

  let decoded: unknown;
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    decoded = JSON.parse(json);
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== "object") return null;
  const c = decoded as Partial<AiCredential>;
  if (typeof c.provider !== "string" || typeof c.apiKey !== "string" || typeof c.model !== "string") {
    return null;
  }

  // Internal providers are never selectable from the client.
  if (getPreset(c.provider)?.internal) return null;

  const credential: AiCredential = {
    provider: c.provider as AiCredential["provider"],
    apiKey: c.apiKey,
    model: c.model,
    baseUrl: typeof c.baseUrl === "string" && c.baseUrl.trim() ? c.baseUrl.trim() : null,
  };

  if (validateCredential(credential) !== null) return null;
  return credential;
}
