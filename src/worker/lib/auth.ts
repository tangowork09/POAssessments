/**
 * Administrator authentication: bcrypt password hash → signed JWT in an
 * httpOnly cookie. Candidates never authenticate; their access is the link
 * token alone.
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../env.js';

export const SESSION_COOKIE = 'ap_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const encoder = new TextEncoder();

export interface AdminClaims {
  sub: string;
  email: string;
  name: string;
}

/** bcryptjs rounds — 10 keeps sign-in inside the Workers CPU budget. */
const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

function secretKey(env: Env): Uint8Array {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return encoder.encode(env.JWT_SECRET);
}

export async function issueSession(c: Context<{ Bindings: Env }>, claims: AdminClaims): Promise<void> {
  const token = await new SignJWT({ email: claims.email, name: claims.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey(c.env));

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    // Local development runs on plain http; everywhere else the cookie is
    // https-only.
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

export function clearSession(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function readSession(c: Context<{ Bindings: Env }>): Promise<AdminClaims | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(c.env));
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? 'Administrator'),
    };
  } catch {
    return null;
  }
}
