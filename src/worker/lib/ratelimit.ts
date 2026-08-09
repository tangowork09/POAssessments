/**
 * Fixed-window rate limiting for unauthenticated endpoints, backed by a D1
 * counter row per (key, window). Good enough for abuse control on a low-volume
 * assessment platform; swap the store for a Durable Object if a single link
 * ever needs to absorb real concurrency.
 */

import type { Env } from '../env.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const bucket = `${key}:${windowStart}`;

  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
      .bind(bucket, windowStart)
      .first<{ count: number }>();

    const count = row?.count ?? 1;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: windowStart + windowSeconds - now,
    };
  } catch (err) {
    // A rate-limit store failure must not take the endpoint down with it.
    console.error('[ratelimit] store error', err);
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
  }
}

/** Best-effort client identity for bucketing. */
export function clientKey(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * Housekeeping — windows older than an hour are dead weight. Called
 * opportunistically from waitUntil, never on the request path.
 */
export async function pruneRateLimits(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(cutoff).run();
}
