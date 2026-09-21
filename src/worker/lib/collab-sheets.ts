/**
 * Building and sending each participant their own sheet.
 *
 * Generated when the facilitator closes a wave, never as people finish. The
 * sheet compares one person against the group, and there is no group until the
 * answers are in: a sheet built on the fifth response would tell that person
 * they are far from a "group" made of four colleagues, and be wrong by the
 * time the wave ended.
 *
 * Only for a named run whose facilitator chose to share. An anonymous run has
 * nobody to send to — that is the trade the organisation made — and a run
 * where sharing was never switched on promised the respondent nothing, so it
 * sends nothing.
 */

import type { Env } from '../env.js';
import { baseUrl } from '../env.js';
import { newId } from './ids.js';
import { generateToken, hashToken } from './tokens.js';
import { sendMail } from './mailer.js';
import { brandingFrom, getSettings } from './settings.js';
import type { CollabSheetPayload, SheetItem } from '../pdf/collab-onepager.js';
import { scoreCollabGroup, scoreCollabResponse } from '../../shared/collab-scoring.js';
import { COLLAB_SECTIONS } from '../../shared/collab.js';
import { collabSheetEmail } from '../email/collab-templates.js';

export interface SheetRun {
  id: string;
  name: string;
  organisation: string;
  anonymous: number;
  share_reports: number;
}

export interface SheetResult {
  built: number;
  sent: number;
  /** Why nothing was built, when nothing was. */
  skipped: string | null;
}

/** How many statements a person is shown themselves against. */
const APART_COUNT = 4;

export async function buildParticipantSheets(
  env: Env,
  run: SheetRun,
  roundNo: number,
  waveLabel: string,
): Promise<SheetResult> {
  if (run.anonymous === 1) {
    return {
      built: 0,
      sent: 0,
      skipped: 'This run is anonymous, so there is nobody to send a personal sheet to.',
    };
  }
  if (run.share_reports !== 1) {
    return {
      built: 0,
      sent: 0,
      skipped: 'This run does not share sheets with participants, so nothing was sent.',
    };
  }

  /*
   * Named runs only, so the address is on the candidate the response belongs
   * to. This is the one place in the diagnostic that reads a respondent's
   * identity, and it does so to post them their own answers and nothing else.
   */
  const { results } = await env.DB.prepare(
    `SELECT r.id AS response_id, cd.email
       FROM responses r
       JOIN candidates cd ON cd.id = r.candidate_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2 AND r.status = 'completed' AND r.anonymous = 0
        AND cd.email NOT LIKE '%@respondent.invalid'`,
  )
    .bind(run.id, roundNo)
    .all<{ response_id: string; email: string }>();

  const people = results ?? [];
  if (people.length === 0) return { built: 0, sent: 0, skipped: 'Nobody finished this wave.' };

  const answers = await env.DB.prepare(
    `SELECT a.response_id, a.no, a.value
       FROM answers a JOIN responses r ON r.id = a.response_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2 AND r.status = 'completed'`,
  )
    .bind(run.id, roundNo)
    .all<{ response_id: string; no: number; value: number }>();

  const byResponse = new Map<string, Record<number, number>>();
  for (const row of answers.results ?? []) {
    let bag = byResponse.get(row.response_id);
    if (!bag) byResponse.set(row.response_id, (bag = {}));
    bag[row.no] = row.value;
  }

  const sheets = [...byResponse.values()];
  const group = scoreCollabGroup(sheets);
  const groupSection = new Map(group.sections.map((s) => [s.key, s.mean]));
  const groupItem = new Map(group.items.map((i) => [i.no, i.mean]));

  const branding = brandingFrom(await getSettings(env));
  const generatedAt = new Date().toISOString().slice(0, 10);

  let built = 0;
  let sent = 0;

  for (const person of people) {
    const own = byResponse.get(person.response_id);
    if (!own) continue;

    let scored;
    try {
      scored = scoreCollabResponse(own);
    } catch {
      // An unfinished sheet cannot be compared with a whole one.
      continue;
    }

    const apart: SheetItem[] = Object.entries(scored.converted)
      .map(([no, value]) => ({
        no: Number(no),
        you: value,
        group: groupItem.get(Number(no)) ?? value,
      }))
      .sort((a, b) => Math.abs(b.you - b.group) - Math.abs(a.you - a.group))
      .slice(0, APART_COUNT);

    /*
     * The figures are stored, not the drawing. Branding is deliberately left
     * out of them: it is looked up when the sheet is opened, so a logo change
     * reaches a sheet that was emailed last month.
     */
    const figures: Omit<CollabSheetPayload, 'branding'> = {
      organisation: run.organisation || run.name,
      waveName: waveLabel,
      groupN: group.n,
      sections: COLLAB_SECTIONS.map((section) => ({
        short: section.short,
        you: scored.sections.find((s) => s.key === section.key)?.mean ?? 0,
        group: groupSection.get(section.key) ?? 0,
      })),
      apart,
      generatedAt,
    };

    const token = generateToken();
    await env.DB.prepare(
      `INSERT INTO collab_participant_sheets (id, response_id, cohort_id, round_no, token_hash, sheet_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(response_id) DO UPDATE SET
         token_hash = excluded.token_hash, sheet_json = excluded.sheet_json,
         created_at = datetime('now'), sent_at = NULL`,
    )
      .bind(
        newId('csheet'),
        person.response_id,
        run.id,
        roundNo,
        await hashToken(token, env.LINK_TOKEN_SECRET),
        JSON.stringify(figures),
      )
      .run();
    built++;

    const mail = collabSheetEmail({
      branding,
      logoUrl: `${baseUrl(env)}/api/logo`,
      organisation: run.organisation || run.name,
      waveName: waveLabel,
      groupN: group.n,
      link: `${baseUrl(env)}/api/report/collab-sheet/${token}`,
    });
    const result = await sendMail(env, { to: person.email, kind: 'collab_sheet', ...mail });
    if (result.status !== 'failed') sent++;
  }

  return { built, sent, skipped: null };
}
