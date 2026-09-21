/**
 * The things a run does while nobody is watching.
 *
 * A facilitator sets a wave up on Monday and the next three weeks happen
 * without them. Anything that needs them to remember a date, or to press a
 * button on a particular afternoon, is the thing that will not happen — and
 * the failure is silent: the wave stays open, people drift, and the debrief
 * is built on whoever happened to answer.
 *
 * So two jobs run on a schedule.
 *
 *   closeDueRuns  — a wave past its closing date closes exactly as if the
 *                   facilitator had pressed Close, participant sheets and all.
 *   sendDueReminders — anybody who has not finished is chased on the days the
 *                   facilitator chose, once per day, never twice.
 *
 * Both are written so that running them twice changes nothing the second
 * time. A scheduler that fires late, fires twice, or overlaps with itself is
 * normal; fifty people receiving two reminders because of it is not.
 */

import type { Env } from '../env.js';
import { baseUrl } from '../env.js';
import { generateToken, hashToken } from './tokens.js';
import { sendMail } from './mailer.js';
import { brandingFrom, getSettings } from './settings.js';
import { buildParticipantSheets } from './collab-sheets.js';
import { magicLinkEmail } from '../email/templates.js';
import { ASSESSMENT_ID } from '../../shared/assessments.js';

export interface ScheduleReport {
  closed: number;
  sheetsSent: number;
  reminded: number;
}

export async function runCollabSchedule(env: Env, now = new Date()): Promise<ScheduleReport> {
  const closed = await closeDueRuns(env, now);
  const reminded = await sendDueReminders(env, now);
  return { ...closed, reminded };
}

/** Waves whose closing date has passed. */
async function closeDueRuns(env: Env, now: Date): Promise<{ closed: number; sheetsSent: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, organisation, anonymous, share_reports
       FROM cohorts
      WHERE assessment_id = ?1 AND status = 'open' AND archived = 0
        AND closes_at IS NOT NULL AND closes_at <= ?2`,
  )
    .bind(ASSESSMENT_ID.collab, now.toISOString().slice(0, 10))
    .all<{ id: string; name: string; organisation: string; anonymous: number; share_reports: number }>();

  let closed = 0;
  let sheetsSent = 0;

  for (const run of results ?? []) {
    /*
     * The status change happens first and unconditionally. If building the
     * sheets then fails, the wave is still closed — which is what the
     * facilitator asked for — and the sheets can be sent by hand. The
     * alternative leaves a wave accepting answers because an email bounced.
     */
    await env.DB.prepare(
      `UPDATE cohorts SET status = 'closed', closed_at = ?2, closes_at = NULL WHERE id = ?1`,
    )
      .bind(run.id, now.toISOString())
      .run();
    closed++;

    const wave = await env.DB.prepare(
      'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY no DESC LIMIT 1',
    )
      .bind(run.id)
      .first<{ no: number; label: string }>();
    if (!wave) continue;

    try {
      const built = await buildParticipantSheets(
        env,
        {
          id: run.id,
          name: run.name,
          organisation: run.organisation,
          anonymous: run.anonymous,
          share_reports: run.share_reports,
        },
        wave.no,
        wave.label.trim() || `Wave ${wave.no}`,
      );
      sheetsSent += built.sent;
    } catch (err) {
      console.error('[collab] closing sent no sheets', run.id, err);
    }
  }

  return { closed, sheetsSent };
}

/**
 * Chases whoever has not finished, on the days the facilitator chose.
 *
 * Each offset fires once per person, recorded on their own link row, so an
 * hourly scheduler sends one reminder on day three rather than twenty-four.
 * The token is rotated on the same row, which is what makes the reminder open
 * their half-finished sheet rather than a new one.
 */
async function sendDueReminders(env: Env, now: Date): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, organisation, reminder_days
       FROM cohorts
      WHERE assessment_id = ?1 AND status = 'open' AND archived = 0
        AND anonymous = 0 AND reminder_days <> '' AND reminder_days <> '[]'`,
  )
    .bind(ASSESSMENT_ID.collab)
    .all<{ id: string; name: string; organisation: string; reminder_days: string }>();

  const runs = results ?? [];
  if (runs.length === 0) return 0;

  const branding = brandingFrom(await getSettings(env));
  const logoUrl = `${baseUrl(env)}/api/logo`;
  let sent = 0;

  for (const run of runs) {
    let offsets: number[];
    try {
      const parsed: unknown = JSON.parse(run.reminder_days);
      offsets = Array.isArray(parsed) ? parsed.filter((v): v is number => Number.isInteger(v) && v > 0) : [];
    } catch {
      continue;
    }
    if (offsets.length === 0) continue;

    const wave = await env.DB.prepare(
      'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
    )
      .bind(run.id)
      .first<{ no: number }>();
    if (!wave) continue;

    const people = await env.DB.prepare(
      `SELECT l.id, l.created_at, l.reminded_days, cd.email
         FROM links l JOIN candidates cd ON cd.id = l.candidate_id
        WHERE l.cohort_id = ?1 AND l.round_no = ?2 AND l.kind = 'personal'
          AND l.self_issued = 0 AND l.active = 1
          AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.link_id = l.id AND r.status = 'completed')`,
    )
      .bind(run.id, wave.no)
      .all<{ id: string; created_at: string; reminded_days: string; email: string }>();

    for (const person of people.results ?? []) {
      const invited = Date.parse(`${person.created_at.replace(' ', 'T')}Z`);
      if (Number.isNaN(invited)) continue;
      const days = Math.floor((now.getTime() - invited) / 86_400_000);

      const already = new Set(
        person.reminded_days
          .split(',')
          // An empty column splits to [''], and Number('') is 0 — which would
          // record a day-zero reminder nobody asked for or sent.
          .filter((v) => v.trim() !== '')
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v)),
      );
      // The largest offset this person has now passed and not yet been sent.
      const due = offsets.filter((d) => days >= d && !already.has(d)).sort((a, b) => b - a)[0];
      if (due === undefined) continue;

      const token = generateToken();
      already.add(due);
      await env.DB.prepare('UPDATE links SET token_hash = ?2, reminded_days = ?3 WHERE id = ?1')
        .bind(person.id, await hashToken(token, env.LINK_TOKEN_SECRET), [...already].sort((a, b) => a - b).join(','))
        .run();

      const mail = magicLinkEmail({
        branding,
        logoUrl,
        name: person.email.split('@')[0] ?? person.email,
        cohortName: run.name,
        organisation: run.organisation,
        link: `${baseUrl(env)}/t/${token}`,
      });
      await sendMail(env, {
        to: person.email,
        kind: 'collab_reminder',
        subject: `${run.name} — a reminder to finish`,
        html: mail.html,
        text: mail.text,
      });
      sent++;
    }
  }

  return sent;
}
