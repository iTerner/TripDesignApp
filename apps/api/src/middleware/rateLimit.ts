import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { apiError } from "../http/errors";

/**
 * Phase 0 baseline for spec §8 "per-IP and per-UID rate limits".
 * In-memory per isolate: good enough to stop a single-client loop, not a
 * distributed guarantee. Phase 6 replaces the store with KV/Durable Objects
 * and adds App Check. Keyed by IP, and additionally by uid once auth ran.
 */
export function rateLimit(
  opts: { limit?: number; windowMs?: number } = {},
): MiddlewareHandler<AppEnv> {
  const limit = opts.limit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const now = c.get("deps").now().getTime();
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
    const keys = uid ? [`ip:${ip}`, `uid:${uid}`] : [`ip:${ip}`];
    for (const key of keys) {
      const b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        continue;
      }
      if (b.count >= limit) {
        c.header("retry-after", String(Math.ceil((b.resetAt - now) / 1000)));
        return apiError(c, 429, "rate_limited", "Too many requests");
      }
      b.count += 1;
    }
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    await next();
  };
}
