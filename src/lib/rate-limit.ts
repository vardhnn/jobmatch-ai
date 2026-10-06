/**
 * In-memory sliding-window rate limiter (per server instance).
 * Fine for a personal single-user app; swap for Redis later if multi-instance.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= max) {
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - bucket.hits[0]) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: max - bucket.hits.length, retryAfterMs: 0 };
}

export function rateLimitKey(req: Request, kind: string): string {
  const fwd = req instanceof Request ? req.headers.get("x-forwarded-for") : null;
  const ip = fwd ? fwd.split(",")[0].trim() : "local";
  return `${kind}:${ip}`;
}
