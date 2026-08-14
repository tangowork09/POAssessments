/**
 * Async pipeline: score → PDF → email.
 *
 * The same functions run from the Queue consumer in production and inline
 * (behind waitUntil) when no Queue binding is present, so `wrangler dev`
 * without Queues provisioned exercises exactly the same code path.
 */

import type { Env, PipelineMessage } from './env.js';
import { newId } from './lib/ids.js';
import { sendMail, type MailResult } from './lib/mailer.js';
import { buildReport } from './lib/report.js';
import { attachPdf, dailySendCap, getSettings, brandingFrom } from './lib/settings.js';
import { generateToken, hashToken } from './lib/tokens.js';
import { inviteEmail, reportEmail } from './email/templates.js';
import { decodeImageDataUrl } from './pdf/image.js';
import { renderReportPdf } from './pdf/report.js';
import { toBase64 } from './pdf/writer.js';
import { baseUrl } from './env.js';
import type { Branding, CandidateDetails } from '../shared/types.js';

/** Anything that can keep work alive past the response — Hono's executionCtx. */
interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** Enqueue when Queues are available, otherwise run it here and now. */
export async function dispatch(env: Env, msg: PipelineMessage, ctx?: WaitUntil): Promise<void> {
  if (env.PIPELINE) {
    await env.PIPELINE.send(msg);
    return;
  }
  const work = handleMessage(env, msg).catch((err) => {
    console.error('[pipeline] inline failure', msg, err);
  });
  if (ctx) ctx.waitUntil(work);
  else await work;
}

export async function handleMessage(env: Env, msg: PipelineMessage): Promise<void> {
  switch (msg.type) {
    case 'score_and_deliver':
      await scoreAndDeliver(env, msg.responseId, msg.reportToken);
      return;
    case 'send_invite':
      await sendBatchInvite(env, msg.batchItemId);
      return;
  }
}

// ------------------------------------------------------------------- scoring

interface ResponseRow {
  id: string;
  assessment_id: string;
  candidate_id: string;
  completed_at: string | null;
  assessment_name: string;
  email: string;
  first_name: string;
  last_name: string;
  organisation: string;
  age_band: string;
  experience_band: string;
  gender: string;
  /** 0 withholds the report email until an administrator sends it by hand. */
  auto_send_report: number;
}

/**
 * Idempotent: a repeated delivery of the same queue message reuses the existing
 * report row and its token rather than minting a second report.
 */
export async function scoreAndDeliver(
  env: Env,
  responseId: string,
  reportToken: string,
): Promise<{ reportToken: string } | null> {
  const row = await env.DB.prepare(
    `SELECT r.id, r.assessment_id, r.candidate_id, r.completed_at,
            a.name AS assessment_name, a.auto_send_report,
            c.email, c.first_name, c.last_name, c.organisation,
            c.age_band, c.experience_band, c.gender
       FROM responses r
       JOIN assessments a ON a.id = r.assessment_id
       JOIN candidates  c ON c.id = r.candidate_id
      WHERE r.id = ?1`,
  )
    .bind(responseId)
    .first<ResponseRow>();

  if (!row) {
    console.error('[pipeline] unknown response', responseId);
    return null;
  }

  const existing = await env.DB.prepare('SELECT id FROM reports WHERE response_id = ?1')
    .bind(responseId)
    .first<{ id: string }>();
  if (existing) {
    console.log('[pipeline] report already exists for', responseId, '— skipping');
    return null;
  }

  const { results } = await env.DB.prepare('SELECT no, value FROM answers WHERE response_id = ?1')
    .bind(responseId)
    .all<{ no: number; value: number }>();
  const answers: Record<number, number> = {};
  for (const a of results ?? []) answers[a.no] = a.value;

  const settings = await getSettings(env);
  const branding = brandingFrom(settings);
  const candidate: CandidateDetails = {
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    organisation: row.organisation,
    ageBand: row.age_band,
    experienceBand: row.experience_band,
    gender: row.gender,
  };

  const report = buildReport({
    reportToken,
    assessmentId: row.assessment_id,
    assessmentName: row.assessment_name,
    candidate,
    completedAt: row.completed_at ?? new Date().toISOString(),
    branding,
    answers,
  });

  // The PDF embeds whatever logo `brandingFrom` resolved — a tenant upload or
  // the house default — so the mark on the report is the same one the
  // candidate saw in the app and in their email. The vector lockup in
  // report.ts is now only a fallback for a logo a PDF cannot carry (SVG,
  // WebP, a corrupt upload), which decodes to null rather than failing.
  const logo = await decodeImageDataUrl(branding.logoDataUrl);
  const pdf = renderReportPdf(report, logo);
  // The stored scores are tagged with their instrument, so a report can be
  // rebuilt years later without asking the assessments table what shape it is.
  const storedScores = report.kind === 'ego' ? report.ego : report.scores;

  const reportId = newId('rpt');
  await env.DB.prepare(
    `INSERT INTO reports (id, response_id, token_hash, scores_json, pdf, pdf_bytes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      reportId,
      responseId,
      await hashToken(reportToken, env.LINK_TOKEN_SECRET),
      JSON.stringify(storedScores),
      pdf,
      pdf.length,
    )
    .run();

  // Scoring and the stored report are unconditional; only delivery is gated.
  // A withheld report is complete and openable by its link — the administrator
  // is choosing when the candidate hears about it, not whether it exists.
  if (row.auto_send_report === 0) {
    console.log('[pipeline] auto-send off for', row.assessment_name, '— report held for manual send');
    return { reportToken };
  }

  await deliverReportEmail(env, {
    reportId,
    reportToken,
    assessmentName: row.assessment_name,
    firstName: candidate.firstName,
    email: candidate.email,
    pdf,
    settings,
    branding,
  });

  return { reportToken };
}

/**
 * Sends one report email and stamps `reports.sent_at`.
 *
 * Shared by the completion pipeline and the admin console's manual send, so a
 * hand-sent report is byte-for-byte the mail an auto-sent one would have been —
 * same template, same cc, same attachment policy.
 */
export async function deliverReportEmail(
  env: Env,
  input: {
    reportId: string;
    reportToken: string;
    assessmentName: string;
    firstName: string;
    email: string;
    pdf: Uint8Array;
    settings: Record<string, string>;
    branding: Branding;
  },
): Promise<MailResult> {
  const attach = attachPdf(input.settings);
  const mail = reportEmail({
    branding: input.branding,
    logoUrl: `${baseUrl(env)}/api/logo`,
    firstName: input.firstName,
    assessmentName: input.assessmentName,
    reportUrl: `${baseUrl(env)}/r/${input.reportToken}`,
    attached: attach,
  });

  const result = await sendMail(env, {
    to: input.email,
    // A fixed operational cc on every report, not a per-candidate choice —
    // unset in dev on purpose, so local testing never sends to a real inbox.
    ...(env.REPORT_CC_EMAIL ? { cc: [env.REPORT_CC_EMAIL] } : {}),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'report',
    ...(attach
      ? {
          attachments: [
            {
              filename: `${slug(input.assessmentName)}-report.pdf`,
              content: toBase64(input.pdf),
              contentType: 'application/pdf',
            },
          ],
        }
      : {}),
  });

  // Only a real send marks it sent: 'logged' means no provider is configured
  // and 'failed' means it bounced, and both must stay re-sendable.
  if (result.status === 'sent') {
    await env.DB.prepare("UPDATE reports SET sent_at = datetime('now') WHERE id = ?1")
      .bind(input.reportId)
      .run();
  }

  return result;
}

// ------------------------------------------------------------- bulk invites

/**
 * Sends one queued invite. The daily cap is checked and consumed atomically
 * here rather than at enqueue time, so a burst that outruns the cap is deferred
 * rather than silently dropped.
 */
export async function sendBatchInvite(env: Env, batchItemId: string): Promise<void> {
  const item = await env.DB.prepare(
    `SELECT i.id, i.batch_id, i.email, i.first_name, i.last_name, i.organisation, i.status,
            b.assessment_id, a.name AS assessment_name, a.question_count
       FROM invite_batch_items i
       JOIN invite_batches b ON b.id = i.batch_id
       JOIN assessments a ON a.id = b.assessment_id
      WHERE i.id = ?1`,
  )
    .bind(batchItemId)
    .first<{
      id: string;
      batch_id: string;
      email: string;
      first_name: string;
      last_name: string;
      organisation: string;
      status: string;
      assessment_id: string;
      assessment_name: string;
      question_count: number;
    }>();

  if (!item || item.status !== 'pending') return;

  const settings = await getSettings(env);
  const cap = dailySendCap(settings);
  const allowed = await consumeSendAllowance(env, cap);
  if (!allowed) {
    await failItem(env, item.id, item.batch_id, `Daily send cap of ${cap} reached — retry tomorrow`);
    return;
  }

  try {
    const { candidateId, token } = await ensureCandidateAndLink(env, {
      assessmentId: item.assessment_id,
      email: item.email,
      firstName: item.first_name,
      lastName: item.last_name,
      organisation: item.organisation,
    });

    const branding = brandingFrom(settings);
    const mail = inviteEmail({
      branding,
      logoUrl: `${baseUrl(env)}/api/logo`,
      firstName: item.first_name,
      assessmentName: item.assessment_name,
      link: `${baseUrl(env)}/t/${token}`,
      questionCount: item.question_count,
    });

    const result = await sendMail(env, {
      to: item.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      kind: 'invite',
    });

    if (result.status === 'failed') {
      await failItem(env, item.id, item.batch_id, result.error ?? 'Send failed');
      return;
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE invite_batch_items SET status = 'sent', error = NULL, candidate_id = ?2 WHERE id = ?1`,
      ).bind(item.id, candidateId),
      env.DB.prepare('UPDATE invite_batches SET sent = sent + 1 WHERE id = ?1').bind(item.batch_id),
    ]);
    await finaliseBatch(env, item.batch_id);
  } catch (err) {
    await failItem(env, item.id, item.batch_id, err instanceof Error ? err.message : String(err));
  }
}

async function failItem(env: Env, itemId: string, batchId: string, error: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE invite_batch_items SET status = 'failed', error = ?2 WHERE id = ?1`).bind(
      itemId,
      error.slice(0, 500),
    ),
    env.DB.prepare('UPDATE invite_batches SET failed = failed + 1 WHERE id = ?1').bind(batchId),
  ]);
  await finaliseBatch(env, batchId);
}

async function finaliseBatch(env: Env, batchId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE invite_batches
        SET status = CASE
              WHEN sent + failed < total THEN 'running'
              WHEN failed = 0 THEN 'done'
              ELSE 'partial' END,
            finished_at = CASE WHEN sent + failed >= total THEN datetime('now') ELSE NULL END
      WHERE id = ?1`,
  )
    .bind(batchId)
    .run();
}

/** Returns false when today's cap is already spent. */
export async function consumeSendAllowance(env: Env, cap: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `INSERT INTO send_ledger (day, count) VALUES (?1, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(day)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count <= cap) return true;
  // Give the slot back so the counter reflects sends, not attempts.
  await env.DB.prepare('UPDATE send_ledger SET count = count - 1 WHERE day = ?1').bind(day).run();
  return false;
}

export async function sendsToday(env: Env): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare('SELECT count FROM send_ledger WHERE day = ?1')
    .bind(day)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// --------------------------------------------------- candidate + link upsert

/**
 * Finds or creates the candidate, their response row and their personal link.
 * Re-inviting an existing candidate returns their existing token, so a resend
 * points at the work already in progress rather than starting a second one.
 */
export async function ensureCandidateAndLink(
  env: Env,
  input: {
    assessmentId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    organisation?: string;
  },
): Promise<{ candidateId: string; token: string; reused: boolean }> {
  const email = input.email.trim().toLowerCase();

  let candidate = await env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
    .bind(email)
    .first<{ id: string }>();

  if (!candidate) {
    const id = newId('cand');
    await env.DB.prepare(
      `INSERT INTO candidates (id, email, first_name, last_name, organisation)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(id, email, input.firstName ?? '', input.lastName ?? '', input.organisation ?? '')
      .run();
    candidate = { id };
  } else {
    // Fill blanks from the new invite without overwriting known values.
    await env.DB.prepare(
      `UPDATE candidates
          SET first_name   = CASE WHEN first_name   = '' THEN ?2 ELSE first_name   END,
              last_name    = CASE WHEN last_name    = '' THEN ?3 ELSE last_name    END,
              organisation = CASE WHEN organisation = '' THEN ?4 ELSE organisation END
        WHERE id = ?1`,
    )
      .bind(candidate.id, input.firstName ?? '', input.lastName ?? '', input.organisation ?? '')
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO responses (id, assessment_id, candidate_id, status)
     VALUES (?1, ?2, ?3, 'invited')
     ON CONFLICT (assessment_id, candidate_id) DO NOTHING`,
  )
    .bind(newId('resp'), input.assessmentId, candidate.id)
    .run();

  // A personal link is permanent. If one exists we hand back the same URL — but
  // the plaintext token is not recoverable from the stored hash, so a resend
  // for an existing link mints a replacement and retires the old row.
  const existing = await env.DB.prepare(
    `SELECT id FROM links WHERE kind = 'personal' AND assessment_id = ?1 AND candidate_id = ?2 AND active = 1`,
  )
    .bind(input.assessmentId, candidate.id)
    .first<{ id: string }>();

  const token = generateToken();
  const tokenHash = await hashToken(token, env.LINK_TOKEN_SECRET);
  const linkId = existing?.id ?? newId('link');

  if (existing) {
    await env.DB.prepare('UPDATE links SET token_hash = ?2 WHERE id = ?1').bind(linkId, tokenHash).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, active)
       VALUES (?1, ?2, 'personal', ?3, ?4, 1)`,
    )
      .bind(linkId, tokenHash, input.assessmentId, candidate.id)
      .run();
  }

  // Point the response at its link.
  await env.DB.prepare('UPDATE responses SET link_id = ?1 WHERE assessment_id = ?2 AND candidate_id = ?3')
    .bind(linkId, input.assessmentId, candidate.id)
    .run();

  return { candidateId: candidate.id, token, reused: Boolean(existing) };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
