/**
 * Link and report tokens.
 *
 * A token is 32 bytes of CSPRNG output in base64url — opaque, and carrying no
 * assessment name, candidate identity or encoded id. What the database stores
 * is HMAC-SHA256(token, LINK_TOKEN_SECRET), so a leaked database copy cannot be
 * turned back into working links, and lookup stays a single indexed equality.
 *
 * Tokens do not expire. There is no TTL field and no expiry check; a link stops
 * working only when an administrator sets links.active = 0.
 */

const encoder = new TextEncoder();

/** 32 random bytes → 43-character base64url string. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function hashToken(token: string, secret: string): Promise<string> {
  if (!secret) throw new Error('LINK_TOKEN_SECRET is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return base64url(new Uint8Array(sig));
}

/** Length- and content-independent comparison, for defence in depth. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Rejects anything that cannot be one of our tokens before it reaches the
 * database, so malformed paths cost no query.
 */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(value);
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
