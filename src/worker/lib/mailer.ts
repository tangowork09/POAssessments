/**
 * Outbound mail.
 *
 * Every message is written to `mail_outbox` first, so the send history is the
 * same object whether or not a provider is configured. With no RESEND_API_KEY
 * the row is marked 'logged' and echoed to the console — development works end
 * to end with no account anywhere.
 */

import type { Env } from '../env.js';
import { newId } from './ids.js';

export interface MailAttachment {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  kind?: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  id: string;
  status: 'sent' | 'logged' | 'failed';
  providerId?: string;
  error?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendMail(env: Env, msg: MailMessage): Promise<MailResult> {
  const id = newId('mail');
  const text = msg.text ?? stripHtml(msg.html);

  await env.DB.prepare(
    `INSERT INTO mail_outbox (id, to_email, cc_email, subject, html, text, kind, status, attempts)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', 0)`,
  )
    .bind(id, msg.to, msg.cc?.join(', ') ?? null, msg.subject, msg.html, text, msg.kind ?? 'generic')
    .run();

  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    const reason = !env.RESEND_API_KEY ? 'RESEND_API_KEY unset' : 'MAIL_FROM unset';
    console.log(
      `[mail:dev] ${reason} — not delivered. to=${msg.to} subject=${JSON.stringify(msg.subject)} outbox=${id}`,
    );
    await mark(env, id, 'logged', null, null);
    return { id, status: 'logged' };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [msg.to],
        ...(msg.cc?.length ? { cc: msg.cc } : {}),
        subject: msg.subject,
        html: msg.html,
        text,
        ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
        ...(msg.attachments?.length
          ? {
              attachments: msg.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
          : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      const error = `Resend ${res.status}: ${body.slice(0, 400)}`;
      await mark(env, id, 'failed', null, error);
      return { id, status: 'failed', error };
    }

    const json = (await res.json()) as { id?: string };
    await mark(env, id, 'sent', json.id ?? null, null);
    return { id, status: 'sent', providerId: json.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await mark(env, id, 'failed', null, error);
    return { id, status: 'failed', error };
  }
}

async function mark(
  env: Env,
  id: string,
  status: 'sent' | 'failed' | 'logged',
  providerId: string | null,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE mail_outbox
        SET status = ?2, provider_id = ?3, error = ?4,
            attempts = attempts + 1,
            sent_at = CASE WHEN ?2 IN ('sent','logged') THEN datetime('now') ELSE sent_at END
      WHERE id = ?1`,
  )
    .bind(id, status, providerId, error)
    .run();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
