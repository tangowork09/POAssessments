/**
 * Administrator authentication: bcrypt password hash → signed JWT in an
 * httpOnly cookie. Candidates never authenticate; their access is the link
 * token alone.
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../env.js';
import type { AdminRole } from '../../shared/types.js';

export const SESSION_COOKIE = 'ap_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const encoder = new TextEncoder();

export interface AdminClaims {
  sub: string;
  email: string;
  name: string;
  role: AdminRole;
}

/** Anything not explicitly 'superadmin' is a plain admin. */
export function toRole(value: unknown): AdminRole {
  return value === 'superadmin' ? 'superadmin' : 'admin';
}

/** The Hono environment every authenticated admin route runs under. */
export interface AdminHono {
  Bindings: Env;
  Variables: {
    admin: AdminClaims;
    /** Snapshots a handler took before changing something. See `audit.ts`. */
    auditEntries?: unknown;
    /** A body a handler chose to expose to the automatic log. */
    auditBody?: unknown;
  };
}

type Ctx = Context<AdminHono>;

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

export async function issueSession(c: Ctx, claims: AdminClaims): Promise<void> {
  const token = await new SignJWT({ email: claims.email, name: claims.name, role: claims.role })
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

export function clearSession(c: Ctx): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function readSession(c: Ctx): Promise<AdminClaims | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(c.env));
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? 'Administrator'),
      role: toRole(payload.role),
    };
  } catch {
    return null;
  }
}

/**
 * Session gate for the console. Lives here rather than in `admin.ts` so every
 * admin router mounts the same check instead of re-deriving one.
 */
export const requireAdmin: MiddlewareHandler<AdminHono> = async (c, next) => {
  const claims = await readSession(c);
  if (!claims) return c.json({ error: 'Not signed in' }, 401);
  c.set('admin', claims);
  await next();
};
