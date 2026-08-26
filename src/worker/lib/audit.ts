/**
 * The admin activity log.
 *
 * Two layers, deliberately.
 *
 * The first is automatic: `auditAll` wraps every admin route and records that a
 * mutating request happened — who, when, which path, what the server answered.
 * Nothing has to be remembered for a new route to appear in the log, which is
 * the only way a log stays complete as the console grows.
 *
 * The second is explicit: a handler that is about to overwrite or destroy
 * something calls `recordBefore` with the row as it stands. That snapshot is
 * what makes the log useful rather than merely accusing — a rotated link's
 * previous token, a replaced roster, a deleted member's email — because with it
 * the change can be undone by hand. Without it, all a log can say is that
 * something was lost.
 *
 * Reads are never logged. A log that records every page view buries the six
 * events that matter in a thousand that do not.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { AdminHono } from './auth.js';
import type { Env } from '../env.js';
import { newId } from './ids.js';

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

/** Anything a handler hands us is stored as JSON, or not at all. */
function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    // A roster upload can be large. The log is a trail, not a backup.
    return text.length > 20_000 ? `${text.slice(0, 20_000)}…[truncated]` : text;
  } catch {
    return null;
  }
}

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? '';
}

/**
 * Writes one entry. Never throws: a failure to log must not fail the action the
 * administrator asked for, and a lost line is recoverable where a refused
 * roster upload is a support call.
 */
export async function writeAudit(
  env: Env,
  actor: { id?: string; email?: string } | null,
  req: Request,
  status: number,
  entry: AuditEntry,
): Promise<void> {
  try {
    const url = new URL(req.url);
    await env.DB.prepare(
      `INSERT INTO admin_audit
         (id, admin_id, admin_email, action, entity, entity_id, summary,
          before_json, after_json, method, path, status, ip)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
      .bind(
        newId('aud'),
        actor?.id ?? null,
        actor?.email ?? null,
        entry.action,
        entry.entity ?? null,
        entry.entityId ?? null,
        entry.summary ?? '',
        json(entry.before),
        json(entry.after),
        req.method,
        url.pathname,
        status,
        clientIp(req),
      )
      .run();
  } catch {
    // Deliberately swallowed. See the doc comment.
  }
}

/**
 * The snapshot a handler takes before it changes something.
 *
 * Held on the request context rather than written immediately, so the entry
 * carries the response status: a rotation the server refused is a different
 * event from one it performed, and the log should not claim the link changed
 * when it did not.
 */
export function recordBefore(c: Context<AdminHono>, entry: AuditEntry): void {
  const held = (c.get('auditEntries') as AuditEntry[] | undefined) ?? [];
  held.push(entry);
  c.set('auditEntries', held);
}

/** Paths whose bodies must never reach the log. */
const SECRET_PATHS = [/\/login$/, /\/password$/, /\/admins?\b/];

function actionFor(method: string, pathname: string): string {
  // `/api/admin/cohorts/coh_123/link` → `cohorts.link`. Ids are dropped: they
  // are already a column, and leaving them in the verb makes it unfilterable.
  const parts = pathname
    .replace(/^\/api\/admin\/?/, '')
    .split('/')
    .filter((p) => p && !/^[a-z]+_[0-9a-f]{8,}$/i.test(p) && !/^\d+$/.test(p));
  return `${parts.join('.') || 'root'}.${method.toLowerCase()}`;
}

/**
 * Records every mutating admin request, including the ones no handler thought
 * to describe. Attach once, above the routes.
 */
export const auditAll: MiddlewareHandler<AdminHono> = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  await next();

  const admin = c.get('admin') as { sub?: string; email?: string } | undefined;
  const actor = admin ? { id: admin.sub, email: admin.email } : null;
  const url = new URL(c.req.raw.url);
  const held = (c.get('auditEntries') as AuditEntry[] | undefined) ?? [];

  if (held.length > 0) {
    for (const entry of held) {
      await writeAudit(c.env, actor, c.req.raw, c.res.status, entry);
    }
    return;
  }

  // Nothing explicit: log the shape of the request anyway. The body is included
  // only where it cannot hold a credential.
  let body: unknown;
  if (!SECRET_PATHS.some((re) => re.test(url.pathname))) {
    body = c.get('auditBody');
  }
  await writeAudit(c.env, actor, c.req.raw, c.res.status, {
    action: actionFor(method, url.pathname),
    entity: url.pathname.split('/')[3] ?? undefined,
    entityId: url.pathname.split('/')[4] ?? undefined,
    summary: '',
    after: body,
  });
};
