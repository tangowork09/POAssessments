import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, looksLikeToken, timingSafeEqual } from '../src/worker/lib/tokens.js';

const SECRET = 'test-link-secret';

describe('generateToken', () => {
  it('produces a 43-character base64url string', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t).not.toContain('=');
    expect(t).not.toContain('+');
    expect(t).not.toContain('/');
  });

  it('does not repeat across a large sample', () => {
    const seen = new Set(Array.from({ length: 3000 }, () => generateToken()));
    expect(seen.size).toBe(3000);
  });

  it('reveals nothing about the caller — no structure to parse', () => {
    // A token is pure randomness: no prefix, no separator, no encoded id.
    const tokens = Array.from({ length: 50 }, () => generateToken());
    expect(tokens.some((t) => t.includes('.') || t.includes(':'))).toBe(false);
    // First characters should vary; a constant prefix would leak a scheme.
    expect(new Set(tokens.map((t) => t[0])).size).toBeGreaterThan(5);
  });
});

describe('hashToken', () => {
  it('is deterministic for the same token and secret', async () => {
    const t = generateToken();
    expect(await hashToken(t, SECRET)).toBe(await hashToken(t, SECRET));
  });

  it('differs for a different token', async () => {
    expect(await hashToken(generateToken(), SECRET)).not.toBe(await hashToken(generateToken(), SECRET));
  });

  it('differs for a different secret — rotating the key invalidates lookups', async () => {
    const t = generateToken();
    expect(await hashToken(t, SECRET)).not.toBe(await hashToken(t, 'other-secret'));
  });

  it('matches a known HMAC-SHA256 vector', async () => {
    // HMAC-SHA256(key='key', msg='The quick brown fox jumps over the lazy dog')
    // = f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8
    const digest = await hashToken('The quick brown fox jumps over the lazy dog', 'key');
    const bytes = Buffer.from(digest.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(bytes.toString('hex')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('is one-way in practice — the digest is not the token', async () => {
    const t = generateToken();
    const h = await hashToken(t, SECRET);
    expect(h).not.toBe(t);
    expect(h).not.toContain(t.slice(0, 8));
  });

  it('refuses to run without a secret', async () => {
    await expect(hashToken('abc', '')).rejects.toThrow(/LINK_TOKEN_SECRET/);
  });
});

describe('looksLikeToken', () => {
  it('accepts real tokens', () => {
    expect(looksLikeToken(generateToken())).toBe(true);
  });

  it('rejects junk before it reaches the database', () => {
    expect(looksLikeToken('')).toBe(false);
    expect(looksLikeToken('short')).toBe(false);
    expect(looksLikeToken("' OR 1=1 --")).toBe(false);
    expect(looksLikeToken('a'.repeat(65))).toBe(false);
    expect(looksLikeToken('has spaces in it aaaaaaaaaaa')).toBe(false);
    expect(looksLikeToken('../../etc/passwd')).toBe(false);
    expect(looksLikeToken(null)).toBe(false);
    expect(looksLikeToken(12345)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('compares equal and unequal strings correctly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
