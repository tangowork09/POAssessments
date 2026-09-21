/**
 * Collaboration Diagnostic runs: the facilitator's side.
 *
 * A run is a cohort whose instrument is the diagnostic and a wave is one of its
 * rounds, so these routes deliberately sit beside `cohorts.ts` rather than
 * inside it. The two instruments share storage and share nothing else: a
 * sociometry cohort cannot open without a roster, scores a network, and reports
 * per member; a diagnostic run can be answered entirely through one shared
 * link, scores an organisation, and reports once for the whole group.
 *
 * Mixing them into one set of handlers would mean a branch on instrument in
 * every route, and the branch that gets forgotten is the one that serves a
 * member report for an instrument that has no members.
 *
 * One route reads an individual's answers, and the shape of that permission is
 * the important part. It serves a *named* run only, because the people in one
 * agreed to exactly this: answers seen by the facilitation team and never
 * shown to anyone in their organisation. It cannot serve an anonymous run even
 * in principle — the response was stored detached from the person, so no query
 * would answer the question — and it writes every read to the audit log by
 * name. A facilitator may look; nobody may look invisibly.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { requireAdmin, type AdminHono } from '../lib/auth.js';
import { auditAll, writeAudit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { ASSESSMENT_ID, ASSESSMENTS } from '../../shared/assessments.js';
import { COLLAB_ITEMS, COLLAB_ITEM_COUNT, COLLAB_SECTIONS, COLLAB_SECTION_BY_KEY } from '../../shared/collab.js';
import { COLLAB_BANDS, scoreCollabResponse } from '../../shared/collab-scoring.js';
import {
  CollabRunError,
  anonymityIsEditable,
  runTurnout,
  scoreRun,
  type CollabRunScores,
} from '../lib/collab-run.js';
import { buildCollabWorkbook } from '../lib/collab-workbook.js';
import { renderCollabReportPdf } from '../pdf/collab-report.js';
import { collabTrend } from '../lib/collab-trend.js';
import { collabBenchmark } from '../lib/collab-benchmark.js';
import { buildParticipantSheets } from '../lib/collab-sheets.js';
import { readRosterFile } from '../lib/collab-roster-file.js';
import { XlsxError } from '../lib/xlsx-read.js';
import { sendMail } from '../lib/mailer.js';
import { magicLinkEmail } from '../email/templates.js';
import { baseUrl } from '../env.js';
import { decodeImageDataUrl } from '../pdf/image.js';
import { brandingFrom, getSettings } from '../lib/settings.js';
import {
  collabFacetsSchema,
  collabInviteSchema,
  collabPersonUpdateSchema,
  collabRunCreateSchema,
  collabRunUpdateSchema,
  fieldErrors,
} from '../lib/validation.js';

export const collabRunRoutes = new Hono<AdminHono>();

collabRunRoutes.use('*', auditAll);
collabRunRoutes.use('*', requireAdmin);

interface RunRow {
  id: string;
  name: string;
  organisation: string;
  status: 'draft' | 'open' | 'closed';
  min_segment: number;
  anonymous: number;
  share_reports: number;
  open_question: string;
  reminder_days: string;
  closes_at: string | null;
  archived: number;
  benchmark_opt_in: number;
  link_ttl_days: number;
  otp_required: number;
  link_only_identity: number;
  created_at: string;
  closed_at: string | null;
}

/**
 * The wave a run is currently on: the open one, else the highest-numbered.
 * A closed run still has a current wave — the last one it ran — because that
 * is the one whose results the console shows.
 */
const CURRENT_ROUND = `
  (SELECT rd.no FROM cohort_rounds rd
    WHERE rd.cohort_id = co.id
    ORDER BY (rd.closed_at IS NULL) DESC, rd.no DESC LIMIT 1)
`;

async function loadRun(env: Env, id: string): Promise<RunRow | null> {
  return env.DB.prepare(
    `SELECT id, name, organisation, status, min_segment, anonymous, share_reports, open_question,
            reminder_days, closes_at, archived, benchmark_opt_in, link_ttl_days,
            otp_required, link_only_identity, created_at, closed_at
       FROM cohorts WHERE id = ?1 AND assessment_id = ?2`,
  )
    .bind(id, ASSESSMENT_ID.collab)
    .first<RunRow>();
}

// ------------------------------------------------------------------- listing

collabRunRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT co.id, co.name, co.organisation, co.status, co.min_segment, co.anonymous,
            co.created_at, co.closed_at, co.closes_at, co.archived,
            COALESCE(${CURRENT_ROUND}, 1) AS round_no,
            (SELECT rd.label FROM cohort_rounds rd
              WHERE rd.cohort_id = co.id AND rd.no = COALESCE(${CURRENT_ROUND}, 1)) AS round_label,
            (SELECT COUNT(*) FROM cohort_rounds rd WHERE rd.cohort_id = co.id) AS wave_count,
            (SELECT COUNT(*) FROM responses r
              WHERE r.cohort_id = co.id AND r.round_no = COALESCE(${CURRENT_ROUND}, 1)
                AND r.status = 'completed') AS completed
       FROM cohorts co
      WHERE co.assessment_id = ?1 AND co.archived = ?2
      ORDER BY co.created_at DESC`,
  )
    .bind(ASSESSMENT_ID.collab, c.req.query('archived') === '1' ? 1 : 0)
    .all();

  return c.json({ runs: results ?? [] });
});

collabRunRoutes.get('/:id', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const waves = await c.env.DB.prepare(
    `SELECT rd.no, rd.label, rd.opened_at, rd.closed_at,
            (SELECT COUNT(*) FROM responses r
              WHERE r.cohort_id = rd.cohort_id AND r.round_no = rd.no AND r.status = 'completed') AS completed
       FROM cohort_rounds rd WHERE rd.cohort_id = ?1 ORDER BY rd.no`,
  )
    .bind(run.id)
    .all();

  const facets = await c.env.DB.prepare(
    `SELECT key, label, options, required, sort_order FROM cohort_facets
      WHERE cohort_id = ?1 ORDER BY sort_order, key`,
  )
    .bind(run.id)
    .all<{ key: string; label: string; options: string; required: number; sort_order: number }>();

  const current = (waves.results ?? []).at(-1);
  const turnout = current ? await runTurnout(c.env, run.id, Number(current.no)) : null;

  return c.json({
    run: {
      ...run,
      anonymous: run.anonymous === 1,
      // The console must not work this out for itself from turnout, which
      // counts the current wave: the rule spans every wave in the run.
      anonymityEditable: await anonymityIsEditable(c.env, run.id),
      shareSheets: run.share_reports === 1,
      openQuestion: run.open_question,
      reminderDays: safeDays(run.reminder_days),
      closesAt: run.closes_at,
      archived: run.archived === 1,
      benchmarkOptIn: run.benchmark_opt_in === 1,
      otpRequired: run.otp_required === 1,
      linkOnlyIdentity: run.link_only_identity === 1,
    },
    waves: waves.results ?? [],
    facets: (facets.results ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      options: safeOptions(f.options),
      required: f.required === 1,
    })),
    turnout,
    instrument: {
      itemCount: COLLAB_ITEM_COUNT,
      sections: COLLAB_SECTIONS.map((s) => ({ key: s.key, short: s.short, color: s.color })),
      bands: COLLAB_BANDS,
    },
  });
});

// -------------------------------------------------------------------- create

collabRunRoutes.post('/', async (c) => {
  const parsed = collabRunCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;
  const id = newId('coh');

  await c.env.DB.prepare(
    `INSERT INTO cohorts (id, assessment_id, name, organisation, status, min_segment, anonymous)
     VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6)`,
  )
    .bind(id, ASSESSMENT_ID.collab, d.name, d.organisation, d.minSegment, d.anonymous ? 1 : 0)
    .run();

  // A run without a wave has responses that belong to nothing, so wave 1 is
  // created with the run rather than on first use.
  await c.env.DB.prepare('INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, 1, ?3)')
    .bind(newId('crd'), id, '')
    .run();

  return c.json({ id }, 201);
});

// -------------------------------------------------------------------- update

collabRunRoutes.patch('/:id', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const parsed = collabRunUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;

  /*
   * Anonymity is a promise made to people at the moment they answer, and it is
   * stamped on each response as it arrives. Changing it once answers exist
   * would leave one wave holding two different promises, and the facilitator
   * could not honestly describe either to the group. The wave has to end first.
   */
  if (d.anonymous !== undefined && d.anonymous !== (run.anonymous === 1)) {
    if (!(await anonymityIsEditable(c.env, run.id))) {
      return c.json(
        {
          error:
            'People have already answered under the current setting, and their responses were stored the way it promised. Start a new run to change how responses are stored.',
        },
        409,
      );
    }
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    binds.push(value);
    sets.push(`${column} = ?${binds.length}`);
  };

  if (d.name !== undefined) set('name', d.name);
  if (d.organisation !== undefined) set('organisation', d.organisation);
  if (d.minSegment !== undefined) set('min_segment', d.minSegment);
  if (d.anonymous !== undefined) set('anonymous', d.anonymous ? 1 : 0);
  if (d.shareSheets !== undefined) set('share_reports', d.shareSheets ? 1 : 0);
  if (d.openQuestion !== undefined) set('open_question', d.openQuestion);
  if (d.reminderDays !== undefined) set('reminder_days', JSON.stringify(d.reminderDays));
  if (d.closesAt !== undefined) set('closes_at', d.closesAt === '' ? null : d.closesAt);
  if (d.benchmarkOptIn !== undefined) set('benchmark_opt_in', d.benchmarkOptIn ? 1 : 0);
  if (d.linkTtlDays !== undefined) set('link_ttl_days', d.linkTtlDays);
  if (d.otpRequired !== undefined) set('otp_required', d.otpRequired ? 1 : 0);
  if (d.linkOnlyIdentity !== undefined) set('link_only_identity', d.linkOnlyIdentity ? 1 : 0);
  if (d.status !== undefined) {
    set('status', d.status);
    set('closed_at', d.status === 'closed' ? new Date().toISOString() : null);
  }
  if (sets.length === 0) return c.json({ ok: true });

  binds.push(run.id);
  await c.env.DB.prepare(`UPDATE cohorts SET ${sets.join(', ')} WHERE id = ?${binds.length}`)
    .bind(...binds)
    .run();

  /*
   * Closing is when a participant's own sheet can honestly be built: it
   * compares them against the group, and until the wave is closed the group is
   * still changing. Sending on completion would post the fifth respondent a
   * comparison against four colleagues.
   */
  let sheets: Awaited<ReturnType<typeof buildParticipantSheets>> | null = null;
  if (d.status === 'closed') {
    const wave = await c.env.DB.prepare(
      'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY no DESC LIMIT 1',
    )
      .bind(run.id)
      .first<{ no: number; label: string }>();
    if (wave) {
      sheets = await buildParticipantSheets(
        c.env,
        {
          id: run.id,
          name: run.name,
          organisation: run.organisation,
          anonymous: d.anonymous === undefined ? run.anonymous : d.anonymous ? 1 : 0,
          share_reports: d.shareSheets === undefined ? run.share_reports : d.shareSheets ? 1 : 0,
        },
        wave.no,
        wave.label.trim() || `Wave ${wave.no}`,
      );
    }
  }

  return c.json({ ok: true, sheets });
});

// -------------------------------------------------------------------- facets

/**
 * Declares the cuts this run collects, replacing whatever was there.
 *
 * Locked once answers exist. A respondent picked from the list they were shown,
 * and renaming an option afterwards rewrites what they said: forty people who
 * chose "Operations" would silently become forty people who chose whatever the
 * facilitator typed over it.
 */
collabRunRoutes.put('/:id/facets', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const parsed = collabFacetsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }

  const answered = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM responses WHERE cohort_id = ?1 AND status IN ('in_progress','completed')`,
  )
    .bind(run.id)
    .first<{ n: number }>();
  if ((answered?.n ?? 0) > 0) {
    return c.json(
      { error: 'People have already answered. The cuts a run collects are fixed once it is under way.' },
      409,
    );
  }

  const keys = parsed.data.facets.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    return c.json({ error: 'Two cuts share a key.' }, 400);
  }

  const statements = [
    c.env.DB.prepare('DELETE FROM cohort_facets WHERE cohort_id = ?1').bind(run.id),
    ...parsed.data.facets.map((f, i) =>
      c.env.DB.prepare(
        `INSERT INTO cohort_facets (cohort_id, key, label, options, required, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(run.id, f.key, f.label, JSON.stringify(f.options), f.required ? 1 : 0, i),
    ),
  ];
  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

// --------------------------------------------------------------------- waves

collabRunRoutes.post('/:id/waves', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';

  const last = await c.env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY no DESC LIMIT 1',
  )
    .bind(run.id)
    .first<{ no: number }>();
  const next = (last?.no ?? 0) + 1;
  const now = new Date().toISOString();

  /*
   * Starting a wave closes the previous one and deletes nothing. The old link
   * keeps resolving and says which wave it belonged to: the person holding it
   * has done nothing wrong, and a dead link teaches them that the exercise is
   * broken rather than finished.
   */
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE cohort_rounds SET closed_at = ?1 WHERE cohort_id = ?2 AND closed_at IS NULL')
      .bind(now, run.id),
    c.env.DB.prepare('INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, ?3, ?4)')
      .bind(newId('crd'), run.id, next, label),
    c.env.DB.prepare("UPDATE cohorts SET status = 'open', closed_at = NULL WHERE id = ?1").bind(run.id),
  ]);

  /*
   * A wave is the same organisation asked again, so the people asked come with
   * it. Invitations are scoped to the wave they were issued for — a link into
   * a closed wave has to stop working — which would leave a facilitator
   * staring at an empty list the moment they started wave two, and retyping
   * fifty addresses they had already entered.
   *
   * Each person gets a new link for the new wave. Their old one keeps pointing
   * at the wave it belonged to and says that wave has finished.
   */
  let carried = 0;
  if (run.anonymous === 0 && last) {
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT cd.id, cd.email
         FROM links l JOIN candidates cd ON cd.id = l.candidate_id
        WHERE l.cohort_id = ?1 AND l.round_no = ?2 AND l.kind = 'personal'
          AND l.self_issued = 0 AND l.active = 1`,
    )
      .bind(run.id, last.no)
      .all<{ id: string; email: string }>();

    const branding = brandingFrom(await getSettings(c.env));
    const logoUrl = `${baseUrl(c.env)}/api/logo`;

    for (const person of results ?? []) {
      const token = generateToken();
      await c.env.DB.prepare(
        `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, cohort_id, round_no, active, self_issued)
         VALUES (?1, ?2, 'personal', ?3, ?4, ?5, ?6, 1, 0)`,
      )
        .bind(
          newId('lnk'),
          await hashToken(token, c.env.LINK_TOKEN_SECRET),
          ASSESSMENT_ID.collab,
          person.id,
          run.id,
          next,
        )
        .run();

      const mail = magicLinkEmail({
        branding,
        logoUrl,
        name: person.email.split('@')[0] ?? person.email,
        cohortName: run.name,
        organisation: run.organisation,
        link: `${baseUrl(c.env)}/t/${token}`,
      });
      await sendMail(c.env, {
        to: person.email,
        kind: 'collab_invite',
        subject: `${run.name} — ${label.trim() || `wave ${next}`}`,
        html: mail.html,
        text: mail.text,
      });
      carried++;
    }
  }

  return c.json({ no: next, carried }, 201);
});

// ---------------------------------------------------------------------- link

/**
 * Issues the shared link for a wave, replacing any link that wave already had.
 *
 * Only a hash of the token is stored, so the plaintext is returned exactly once
 * here and can never be shown again. Rotating is how a link that reached the
 * wrong inbox is taken out of service.
 */
collabRunRoutes.post('/:id/link', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const current = await c.env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(run.id)
    .first<{ no: number }>();
  if (!current) return c.json({ error: 'This run has no wave to link to.' }, 409);

  const token = generateToken();
  const expires =
    run.link_ttl_days > 0
      ? new Date(Date.now() + run.link_ttl_days * 86_400_000).toISOString()
      : null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM links WHERE cohort_id = ?1 AND round_no = ?2 AND kind = 'generic'`,
    ).bind(run.id, current.no),
    c.env.DB.prepare(
      `INSERT INTO links (id, token_hash, kind, assessment_id, cohort_id, round_no, expires_at)
       VALUES (?1, ?2, 'generic', ?3, ?4, ?5, ?6)`,
    ).bind(
      newId('lnk'),
      await hashToken(token, c.env.LINK_TOKEN_SECRET),
      ASSESSMENT_ID.collab,
      run.id,
      current.no,
      expires,
    ),
  ]);

  return c.json({ token, wave: current.no, expiresAt: expires }, 201);
});

// ------------------------------------------------------------------- results

collabRunRoutes.get('/:id/results', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const requested = c.req.query('wave');
  let wave = requested ? Number(requested) : null;
  if (wave !== null && (!Number.isInteger(wave) || wave < 1)) {
    return c.json({ error: 'That is not a wave number.' }, 400);
  }
  if (wave === null) {
    const current = await c.env.DB.prepare(
      'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
    )
      .bind(run.id)
      .first<{ no: number }>();
    wave = current?.no ?? 1;
  }

  let scores: CollabRunScores;
  try {
    scores = await scoreRun(c.env, { id: run.id, min_segment: run.min_segment }, wave);
  } catch (err) {
    if (err instanceof CollabRunError) return c.json({ error: err.message, wave }, 409);
    throw err;
  }

  /*
   * The statements travel with the figures. A results screen that has a mean
   * for item 14 and has to look up what item 14 says is one refactor away from
   * showing the right number against the wrong statement, and the reader has
   * no way to catch it.
   */
  /*
   * The open answers, if the run asked one. Verbatim and unattributed: they
   * are quotations, never counted, and in an anonymous run there is nothing
   * to attribute them to anyway.
   */
  const comments = await c.env.DB.prepare(
    'SELECT text FROM collab_open_answers WHERE cohort_id = ?1 AND round_no = ?2 ORDER BY created_at',
  )
    .bind(run.id, wave)
    .all<{ text: string }>();

  return c.json({
    run: { id: run.id, name: run.name, organisation: run.organisation, anonymous: run.anonymous === 1 },
    wave,
    minSegment: run.min_segment,
    openQuestion: run.open_question,
    comments: (comments.results ?? []).map((row) => row.text),
    statements: COLLAB_ITEMS.map((item) => ({
      no: item.no,
      text: item.text,
      direction: item.direction,
      section: COLLAB_SECTION_BY_KEY.get(item.sectionKey)?.short ?? '',
    })),
    ...scores,
  });
});

/**
 * The wave as a workbook.
 *
 * A facilitator argues with a diagnostic after the debrief: re-cutting a
 * department, checking whether a bad-looking item is one people disagreed
 * about, pasting a section into a slide. That needs the numbers, not a picture
 * of the screen.
 */
collabRunRoutes.get('/:id/xlsx', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const requested = c.req.query('wave');
  let wave = requested ? Number(requested) : null;
  if (wave !== null && (!Number.isInteger(wave) || wave < 1)) {
    return c.json({ error: 'That is not a wave number.' }, 400);
  }
  const waveRow = await c.env.DB.prepare(
    wave === null
      ? 'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1'
      : 'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 AND no = ?2',
  )
    .bind(...(wave === null ? [run.id] : [run.id, wave]))
    .first<{ no: number; label: string }>();
  if (!waveRow) return c.json({ error: 'That wave does not exist.' }, 404);
  wave = waveRow.no;

  let scores: CollabRunScores;
  try {
    scores = await scoreRun(c.env, { id: run.id, min_segment: run.min_segment }, wave);
  } catch (err) {
    if (err instanceof CollabRunError) return c.json({ error: err.message, wave }, 409);
    throw err;
  }

  const buffer = await buildCollabWorkbook({
    runName: run.name,
    organisation: run.organisation,
    waveNo: wave,
    waveName: waveRow.label.trim() || `Wave ${wave}`,
    anonymous: run.anonymous === 1,
    minSegment: run.min_segment,
    scores,
  });

  const slug = run.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  return new Response(buffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${slug}-wave-${wave}.xlsx"`,
    },
  });
});

/**
 * The wave as the report a client is handed.
 *
 * Generated on demand rather than stored. A diagnostic report is read against
 * the responses that existed when it was asked for, and a stored PDF quietly
 * becomes a claim about a wave that has since taken more answers.
 */
collabRunRoutes.get('/:id/pdf', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const requested = c.req.query('wave');
  if (requested && (!Number.isInteger(Number(requested)) || Number(requested) < 1)) {
    return c.json({ error: 'That is not a wave number.' }, 400);
  }
  const waveRow = await c.env.DB.prepare(
    requested
      ? 'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 AND no = ?2'
      : 'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(...(requested ? [run.id, Number(requested)] : [run.id]))
    .first<{ no: number; label: string }>();
  if (!waveRow) return c.json({ error: 'That wave does not exist.' }, 404);

  let scores: CollabRunScores;
  try {
    scores = await scoreRun(c.env, { id: run.id, min_segment: run.min_segment }, waveRow.no);
  } catch (err) {
    if (err instanceof CollabRunError) return c.json({ error: err.message, wave: waveRow.no }, 409);
    throw err;
  }

  const branding = brandingFrom(await getSettings(c.env));
  const logo = await decodeImageDataUrl(branding.logoDataUrl);

  const noteRows = await c.env.DB.prepare(
    'SELECT section_key, note FROM collab_notes WHERE cohort_id = ?1 AND round_no = ?2',
  )
    .bind(run.id, waveRow.no)
    .all<{ section_key: string; note: string }>();
  const notes: Record<string, string> = {};
  for (const row of noteRows.results ?? []) notes[row.section_key] = row.note;

  const commentRows = await c.env.DB.prepare(
    'SELECT text FROM collab_open_answers WHERE cohort_id = ?1 AND round_no = ?2 ORDER BY created_at',
  )
    .bind(run.id, waveRow.no)
    .all<{ text: string }>();

  const strongest = COLLAB_SECTION_BY_KEY.get(scores.group.gap.strongestKey)?.short ?? '';
  const weakest = COLLAB_SECTION_BY_KEY.get(scores.group.gap.weakestKey)?.short ?? '';

  const bytes = renderCollabReportPdf(
    {
      runName: run.name,
      organisation: run.organisation,
      waveName: waveRow.label.trim() || `Wave ${waveRow.no}`,
      n: scores.group.n,
      incomplete: scores.group.incomplete,
      invited: scores.turnout.invited,
      anonymous: run.anonymous === 1,
      minSegment: run.min_segment,
      total: scores.group.total,
      perItem: scores.group.perItem,
      bandKey: scores.group.band.key,
      bandName: scores.group.band.name,
      bandReading: scores.group.band.reading,
      sections: scores.group.sections.map((s) => ({
        key: s.key,
        short: s.short,
        mean: s.mean,
        spread: s.spread,
      })),
      items: scores.group.items,
      gap: { strongest, weakest, value: scores.group.gap.value },
      attention: scores.group.attention,
      strengths: scores.group.strengths,
      split: scores.group.split,
      cuts: scores.cuts.map((cut) => ({ label: cut.label, segments: cut.segments })),
      notes,
      openQuestion: run.open_question,
      comments: (commentRows.results ?? []).map((row) => row.text),
      branding,
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    logo,
  );

  const slug = run.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${slug}-wave-${waveRow.no}-report.pdf"`,
    },
  });
});

// ----------------------------------------------------------- benchmark

collabRunRoutes.get('/:id/benchmark', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  return c.json(await collabBenchmark(c.env, run.id));
});

// --------------------------------------------------- the facilitator's read

/** What the facilitator wants said about each section, printed in the report. */
collabRunRoutes.get('/:id/notes', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const wave = Number(c.req.query('wave')) || (await currentWaveNo(c.env, run.id));
  const { results } = await c.env.DB.prepare(
    'SELECT section_key, note FROM collab_notes WHERE cohort_id = ?1 AND round_no = ?2',
  )
    .bind(run.id, wave)
    .all<{ section_key: string; note: string }>();

  const notes: Record<string, string> = {};
  for (const row of results ?? []) notes[row.section_key] = row.note;
  return c.json({ wave, notes });
});

collabRunRoutes.put('/:id/notes', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { wave?: unknown; notes?: unknown };
  const wave = Number(body.wave) || (await currentWaveNo(c.env, run.id));
  const notes = body.notes && typeof body.notes === 'object' ? (body.notes as Record<string, unknown>) : {};

  const valid = new Set(['', ...COLLAB_SECTIONS.map((s) => s.key)]);
  const statements: ReturnType<typeof c.env.DB.prepare>[] = [];
  for (const [key, value] of Object.entries(notes)) {
    if (!valid.has(key)) continue;
    const text = typeof value === 'string' ? value.trim().slice(0, 2000) : '';
    statements.push(
      text === ''
        ? c.env.DB.prepare('DELETE FROM collab_notes WHERE cohort_id = ?1 AND round_no = ?2 AND section_key = ?3')
            .bind(run.id, wave, key)
        : c.env.DB.prepare(
            `INSERT INTO collab_notes (cohort_id, round_no, section_key, note)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(cohort_id, round_no, section_key)
             DO UPDATE SET note = excluded.note, updated_at = datetime('now')`,
          ).bind(run.id, wave, key, text),
    );
  }
  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json({ ok: true, wave });
});

async function currentWaveNo(env: Env, cohortId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(cohortId)
    .first<{ no: number }>();
  return row?.no ?? 1;
}

// ------------------------------------------------------------- preview

/**
 * Exactly what a respondent will be shown.
 *
 * Before a diagnostic goes to fifty executives, the person sending it wants to
 * read it. Issuing a link and opening it yourself works, but it starts a
 * response and burns a link, so the questions come back here instead —
 * including the background questions and the optional open one, in the order
 * they are asked, and with the section headings still withheld the way the
 * master copy requires.
 */
collabRunRoutes.get('/:id/preview', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const facets = await c.env.DB.prepare(
    'SELECT key, label, options, required FROM cohort_facets WHERE cohort_id = ?1 ORDER BY sort_order, key',
  )
    .bind(run.id)
    .all<{ key: string; label: string; options: string; required: number }>();

  const config = ASSESSMENTS.collab;
  return c.json({
    intro: config.intro,
    scale: config.scale,
    anonymous: run.anonymous === 1,
    facets: (facets.results ?? []).map((f) => ({
      label: f.label,
      options: safeOptions(f.options),
      required: f.required === 1,
    })),
    // Statement text only. No section, no direction: this is the respondent's
    // view, and it is a preview of that view rather than of the scoring key.
    statements: COLLAB_ITEMS.map((item) => ({ no: item.no, text: item.text })),
    openQuestion: run.open_question,
  });
});

// ------------------------------------------------------------ roster file

/**
 * Reads a participant list out of a spreadsheet and previews it.
 *
 * Preview, not import: a facilitator pasting the wrong tab of the wrong
 * workbook should find that out before fifty people are emailed, not after.
 * The console shows what was read and invites them separately.
 */
collabRunRoutes.post('/:id/roster/parse', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: 'That upload was empty.' }, 400);
  if (bytes.length > 4_000_000) {
    return c.json({ error: 'That file is larger than a participant list should ever be.' }, 400);
  }

  try {
    const parsed = await readRosterFile(bytes);
    return c.json(parsed);
  } catch (err) {
    if (err instanceof XlsxError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

// ------------------------------------------------------- outstanding export

/**
 * Who has not finished, as a file.
 *
 * Facilitators chase people in their mail client, not in this console. The
 * list they need is names and addresses, in something they can paste.
 */
collabRunRoutes.get('/:id/outstanding.csv', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.anonymous === 1) {
    return c.json({ error: 'An anonymous run cannot say who has not answered.' }, 409);
  }

  const wave = await c.env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(run.id)
    .first<{ no: number }>();
  if (!wave) return c.json({ error: 'This run has no wave.' }, 409);

  const { results } = await c.env.DB.prepare(
    `SELECT cd.first_name AS name, cd.email,
            (SELECT m.function FROM cohort_members m
              WHERE m.cohort_id = l.cohort_id AND m.email = cd.email AND m.active = 1 LIMIT 1) AS department,
            (SELECT r.status FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS status,
            (SELECT r.answered_count FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS answered
       FROM links l JOIN candidates cd ON cd.id = l.candidate_id
      WHERE l.cohort_id = ?1 AND l.round_no = ?2 AND l.kind = 'personal'
        AND l.self_issued = 0 AND l.active = 1
        AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.link_id = l.id AND r.status = 'completed')
      ORDER BY cd.email`,
  )
    .bind(run.id, wave.no)
    .all<{ name: string; email: string; department: string | null; status: string | null; answered: number | null }>();

  const rows = [
    ['Name', 'Email', 'Department', 'Progress'],
    ...(results ?? []).map((row) => [
      row.name ?? '',
      row.email,
      row.department ?? '',
      row.status === 'in_progress' ? `${row.answered ?? 0} of 24` : 'Not started',
    ]),
  ];
  const csv = rows
    .map((cells) => cells.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))
    .join('\r\n');

  const slug = run.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  return new Response('\ufeff' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-outstanding.csv"`,
    },
  });
});

// ---------------------------------------------------------- archive, delete

/**
 * Archives a run, or deletes one that never collected anything.
 *
 * A run holding answers is archived, never destroyed: those answers were given
 * under a promise, and removing them to tidy a list is not a decision a
 * console should make easy. A run with no responses is a typo, and deleting a
 * typo is housekeeping.
 */
collabRunRoutes.delete('/:id', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const answered = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM responses WHERE cohort_id = ?1 AND status IN ('in_progress','completed')`,
  )
    .bind(run.id)
    .first<{ n: number }>();

  if ((answered?.n ?? 0) > 0) {
    await c.env.DB.prepare('UPDATE cohorts SET archived = 1 WHERE id = ?1').bind(run.id).run();
    return c.json({ archived: true, responses: answered?.n ?? 0 });
  }

  await c.env.DB.prepare('DELETE FROM cohorts WHERE id = ?1').bind(run.id).run();
  return c.json({ archived: false, deleted: true });
});

/** Puts an archived run back on the list. */
collabRunRoutes.post('/:id/restore', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  await c.env.DB.prepare('UPDATE cohorts SET archived = 0 WHERE id = ?1').bind(run.id).run();
  return c.json({ ok: true });
});

/**
 * Copies a run's setup, without a single answer.
 *
 * The second client gets the same background questions, the same floor and the
 * same sharing decision. What it does not get is anybody's responses, which is
 * the whole point: a duplicate is a fresh diagnostic of a different
 * organisation, not a copy of somebody else's results.
 */
collabRunRoutes.post('/:id/duplicate', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; organisation?: unknown };
  const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : `${run.name} (copy)`;
  const organisation = typeof body.organisation === 'string' ? body.organisation.trim() : run.organisation;

  const id = newId('coh');
  await c.env.DB.prepare(
    `INSERT INTO cohorts (id, assessment_id, name, organisation, status, min_segment, anonymous,
                          share_reports, open_question, reminder_days)
     VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      id,
      ASSESSMENT_ID.collab,
      name,
      organisation,
      run.min_segment,
      run.anonymous,
      run.share_reports,
      run.open_question,
      run.reminder_days,
    )
    .run();

  await c.env.DB.prepare('INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, 1, ?3)')
    .bind(newId('crd'), id, '')
    .run();

  const { results } = await c.env.DB.prepare(
    'SELECT key, label, options, required, sort_order FROM cohort_facets WHERE cohort_id = ?1',
  )
    .bind(run.id)
    .all<{ key: string; label: string; options: string; required: number; sort_order: number }>();

  for (const facet of results ?? []) {
    await c.env.DB.prepare(
      `INSERT INTO cohort_facets (cohort_id, key, label, options, required, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(id, facet.key, facet.label, facet.options, facet.required, facet.sort_order)
      .run();
  }

  return c.json({ id }, 201);
});

// -------------------------------------------------------------- responses

/**
 * Every response in a wave, in full, with nobody's name on it.
 *
 * An anonymous run has no roster to open, and a facilitator was being shown a
 * blank tab — which reads as "this tool is hiding something" rather than "this
 * data has no identity in it". Both are wrong. The answers exist and are worth
 * reading; what does not exist is any way to attach them to a person.
 *
 * So this returns the complete set, numbered rather than named, in the order
 * they were completed. The numbering is presentational and deliberately says
 * nothing: response 4 is the fourth sheet finished, not the fourth person on
 * any list, and there is no list.
 */
collabRunRoutes.get('/:id/responses', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const wave = Number(c.req.query('wave')) || (await currentWaveNo(c.env, run.id));

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.status, r.answered_count, r.completed_at, r.anonymous
       FROM responses r
      WHERE r.cohort_id = ?1 AND r.round_no = ?2
      ORDER BY COALESCE(r.completed_at, r.invited_at)`,
  )
    .bind(run.id, wave)
    .all<{ id: string; status: string; answered_count: number; completed_at: string | null; anonymous: number }>();

  const rows = results ?? [];
  const facets = await c.env.DB.prepare(
    `SELECT f.response_id, f.key, f.value
       FROM response_facets f JOIN responses r ON r.id = f.response_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2`,
  )
    .bind(run.id, wave)
    .all<{ response_id: string; key: string; value: string }>();

  const byResponse = new Map<string, Record<string, string>>();
  for (const row of facets.results ?? []) {
    let bag = byResponse.get(row.response_id);
    if (!bag) byResponse.set(row.response_id, (bag = {}));
    bag[row.key] = row.value;
  }

  return c.json({
    wave,
    anonymous: run.anonymous === 1,
    responses: rows.map((row, i) => ({
      responseId: row.id,
      // Presentational only: the order these were finished in, which is not
      // the order of any list of people, because there is no such list.
      label: `Response ${i + 1}`,
      status: row.status,
      answered: row.answered_count,
      completedAt: row.completed_at,
      facets: byResponse.get(row.id) ?? {},
    })),
  });
});

/** One response, in full, against the group. Carries no identity either. */
collabRunRoutes.get('/:id/responses/:responseId/answers', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const row = await c.env.DB.prepare(
    `SELECT id, status, round_no FROM responses WHERE id = ?1 AND cohort_id = ?2`,
  )
    .bind(c.req.param('responseId'), run.id)
    .first<{ id: string; status: string; round_no: number }>();
  if (!row) return c.json({ error: 'That response is not part of this run.' }, 404);
  if (row.status !== 'completed') return c.json({ status: row.status, answers: null });

  const { results } = await c.env.DB.prepare(
    'SELECT no, value FROM answers WHERE response_id = ?1 ORDER BY no',
  )
    .bind(row.id)
    .all<{ no: number; value: number }>();

  const raw: Record<number, number> = {};
  for (const answer of results ?? []) raw[answer.no] = answer.value;

  let scored;
  try {
    scored = scoreCollabResponse(raw);
  } catch {
    return c.json({ status: row.status, answers: null });
  }

  let groupItem = new Map<number, number>();
  let groupN = 0;
  try {
    const group = await scoreRun(c.env, { id: run.id, min_segment: run.min_segment }, row.round_no);
    groupItem = new Map(group.group.items.map((i) => [i.no, i.mean]));
    groupN = group.group.n;
  } catch {
    // A wave with nothing complete has no group to compare against.
  }

  /*
   * Logged like the named read. Nothing here identifies anybody, but a record
   * of who opened what is how a facilitation team stays able to say, later and
   * truthfully, what was looked at.
   */
  await writeAudit(c.env, c.get('admin') ?? null, c.req.raw, 200, {
    action: 'collab.response.answers.read',
    entity: 'collab_run',
    entityId: run.id,
    summary: `Read one anonymous response for ${run.name}`,
  });

  return c.json({
    status: row.status,
    groupN,
    total: scored.total,
    perItem: scored.perItem,
    sections: scored.sections.map((s) => ({ key: s.key, short: s.short, mean: s.mean })),
    answers: COLLAB_ITEMS.map((item) => ({
      no: item.no,
      text: item.text,
      section: COLLAB_SECTION_BY_KEY.get(item.sectionKey)?.short ?? '',
      direction: item.direction,
      chose: raw[item.no] ?? null,
      converted: scored.converted[item.no] ?? null,
      group: groupItem.get(item.no) ?? null,
    })),
  });
});

// ---------------------------------------------------------- participants

/**
 * Who was invited to this wave, and where each of them got to.
 *
 * Only for a named run: an anonymous run has nobody to list, which is the
 * whole point of it. Note what this does *not* return — nobody's answers. The
 * facilitator needs to know who has finished so they can chase, and that is a
 * different fact from what any of them said.
 */
collabRunRoutes.get('/:id/participants', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.anonymous === 1) return c.json({ participants: [], anonymous: true });

  const wave = await c.env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(run.id)
    .first<{ no: number }>();
  if (!wave) return c.json({ participants: [], anonymous: false });

  const { results } = await c.env.DB.prepare(
    `SELECT l.id AS link_id, cd.email, cd.first_name AS name, l.created_at, l.last_seen_at, l.expires_at,
            (SELECT m.function FROM cohort_members m
              WHERE m.cohort_id = l.cohort_id AND m.email = cd.email AND m.active = 1 LIMIT 1) AS department,
            (SELECT r.status FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS status,
            (SELECT r.answered_count FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS answered
       FROM links l
       JOIN candidates cd ON cd.id = l.candidate_id
      WHERE l.cohort_id = ?1 AND l.round_no = ?2 AND l.kind = 'personal'
        AND l.self_issued = 0 AND l.active = 1
      ORDER BY cd.email`,
  )
    .bind(run.id, wave.no)
    .all<{
      link_id: string;
      email: string;
      name: string;
      department: string | null;
      created_at: string;
      last_seen_at: string | null;
      expires_at: string | null;
      status: string | null;
      answered: number | null;
    }>();

  return c.json({
    anonymous: false,
    wave: wave.no,
    participants: (results ?? []).map((row) => ({
      linkId: row.link_id,
      email: row.email,
      name: row.name ?? '',
      department: row.department ?? '',
      invitedAt: row.created_at,
      openedAt: row.last_seen_at,
      status: row.status ?? 'invited',
      answered: row.answered ?? 0,
    })),
  });
});

/**
 * What one named respondent answered.
 *
 * This is the only place in the diagnostic where an individual's answers are
 * readable, and it exists because the facilitation team runs the debrief: a
 * facilitator who can see that one leader marked Trust two points below
 * everybody else can go and have that conversation. The confidentiality line
 * these respondents agreed to says their answers are seen only by the
 * facilitation team and are never shown to anyone in their organisation,
 * which is exactly this and no more.
 *
 * Two limits hold it to that.
 *
 * An anonymous run is refused, and cannot be served even in principle: the
 * response was stored detached from the person, so there is no query that
 * would answer this question. That refusal is the promise working, not a
 * missing feature.
 *
 * And every read is written to the audit log by name — who looked, at whom,
 * when. A facilitator is allowed to look; nobody should be able to look
 * without it being visible that they did.
 */
collabRunRoutes.get('/:id/participants/:linkId/answers', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.anonymous === 1) {
    return c.json(
      {
        error:
          'This run is anonymous. Responses are stored detached from the people who gave them, so there is no way to look up what any one person answered.',
      },
      409,
    );
  }

  const person = await c.env.DB.prepare(
    `SELECT l.id, cd.email,
            (SELECT r.id FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS response_id,
            (SELECT r.status FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS status,
            (SELECT r.round_no FROM responses r WHERE r.link_id = l.id ORDER BY r.invited_at DESC LIMIT 1) AS round_no
       FROM links l JOIN candidates cd ON cd.id = l.candidate_id
      WHERE l.id = ?1 AND l.cohort_id = ?2 AND l.kind = 'personal' AND l.self_issued = 0`,
  )
    .bind(c.req.param('linkId'), run.id)
    .first<{ id: string; email: string; response_id: string | null; status: string | null; round_no: number | null }>();

  if (!person) return c.json({ error: 'That person is not on this run.' }, 404);
  if (!person.response_id || person.status !== 'completed') {
    return c.json({ email: person.email, status: person.status ?? 'invited', answers: null });
  }

  const { results } = await c.env.DB.prepare(
    'SELECT no, value FROM answers WHERE response_id = ?1 ORDER BY no',
  )
    .bind(person.response_id)
    .all<{ no: number; value: number }>();

  const raw: Record<number, number> = {};
  for (const row of results ?? []) raw[row.no] = row.value;

  let scored;
  try {
    scored = scoreCollabResponse(raw);
  } catch {
    return c.json({ email: person.email, status: person.status, answers: null });
  }

  // The group, so a single answer can be read against something. One person's
  // 2 means nothing until you know the room said 4.
  let groupItem = new Map<number, number>();
  let groupN = 0;
  try {
    const group = await scoreRun(c.env, { id: run.id, min_segment: run.min_segment }, person.round_no ?? 1);
    groupItem = new Map(group.group.items.map((i) => [i.no, i.mean]));
    groupN = group.group.n;
  } catch {
    // A wave with nothing complete in it has no group to compare against.
  }

  await writeAudit(c.env, c.get('admin') ?? null, c.req.raw, 200, {
    action: 'collab.participant.answers.read',
    entity: 'collab_run',
    entityId: run.id,
    summary: `Read ${person.email}'s individual answers for ${run.name}`,
  });

  return c.json({
    email: person.email,
    status: person.status,
    wave: person.round_no ?? 1,
    groupN,
    total: scored.total,
    perItem: scored.perItem,
    sections: scored.sections.map((section) => ({ key: section.key, short: section.short, mean: section.mean })),
    answers: COLLAB_ITEMS.map((item) => ({
      no: item.no,
      text: item.text,
      section: COLLAB_SECTION_BY_KEY.get(item.sectionKey)?.short ?? '',
      direction: item.direction,
      chose: raw[item.no] ?? null,
      converted: scored.converted[item.no] ?? null,
      group: groupItem.get(item.no) ?? null,
    })),
  });
});

/** Corrects who somebody is, or which department they answer for. */
collabRunRoutes.patch('/:id/participants/:linkId', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const parsed = collabPersonUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }

  const person = await c.env.DB.prepare(
    `SELECT l.id, cd.id AS candidate_id, cd.email, cd.first_name AS name
       FROM links l JOIN candidates cd ON cd.id = l.candidate_id
      WHERE l.id = ?1 AND l.cohort_id = ?2 AND l.kind = 'personal' AND l.self_issued = 0`,
  )
    .bind(c.req.param('linkId'), run.id)
    .first<{ id: string; candidate_id: string; email: string; name: string }>();
  if (!person) return c.json({ error: 'That person is not on this run.' }, 404);

  if (parsed.data.name !== undefined) {
    await c.env.DB.prepare('UPDATE candidates SET first_name = ?2 WHERE id = ?1')
      .bind(person.candidate_id, parsed.data.name)
      .run();
  }

  /*
   * A department change reaches the results only for people who have not yet
   * answered. Once somebody has submitted, the department stamped on their
   * response is where they were when they answered it, and editing the roster
   * must not quietly move their answers into another department's average
   * after the facilitator has read it.
   */
  const answered = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM responses WHERE link_id = ?1 AND status = 'completed'`,
  )
    .bind(person.id)
    .first<{ n: number }>();

  await upsertMember(
    c.env,
    run.id,
    person.email,
    parsed.data.name ?? person.name,
    parsed.data.department,
  );

  return c.json({ ok: true, appliesToAnswers: (answered?.n ?? 0) === 0 });
});

/**
 * Takes somebody off the invitation list.
 *
 * Their link stops working, and any answers they have already given stay
 * exactly where they are. Removing a person is a statement about who is being
 * asked, never a way to delete what somebody said: a facilitator who could
 * quietly drop an inconvenient respondent from the average would be running a
 * different exercise.
 */
collabRunRoutes.delete('/:id/participants/:linkId', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const link = await c.env.DB.prepare(
    `SELECT l.id, (SELECT COUNT(*) FROM responses r WHERE r.link_id = l.id AND r.status = 'completed') AS finished
       FROM links l WHERE l.id = ?1 AND l.cohort_id = ?2 AND l.kind = 'personal' AND l.self_issued = 0`,
  )
    .bind(c.req.param('linkId'), run.id)
    .first<{ id: string; finished: number }>();
  if (!link) return c.json({ error: 'That person is not on this run.' }, 404);

  await c.env.DB.prepare('UPDATE links SET active = 0 WHERE id = ?1').bind(link.id).run();
  return c.json({
    ok: true,
    keptAnswers: link.finished > 0,
  });
});

/** Sends one person their link again, rotating the token on their own row. */
collabRunRoutes.post('/:id/participants/:linkId/resend', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const row = await c.env.DB.prepare(
    `SELECT l.id, cd.email FROM links l
       JOIN candidates cd ON cd.id = l.candidate_id
      WHERE l.id = ?1 AND l.cohort_id = ?2 AND l.kind = 'personal' AND l.self_issued = 0 AND l.active = 1`,
  )
    .bind(c.req.param('linkId'), run.id)
    .first<{ id: string; email: string }>();
  if (!row) return c.json({ error: 'That person is not on this run.' }, 404);

  const token = generateToken();
  await c.env.DB.prepare('UPDATE links SET token_hash = ?2 WHERE id = ?1')
    .bind(row.id, await hashToken(token, c.env.LINK_TOKEN_SECRET))
    .run();

  const branding = brandingFrom(await getSettings(c.env));
  const mail = magicLinkEmail({
    branding,
    logoUrl: `${baseUrl(c.env)}/api/logo`,
    name: row.email.split('@')[0] ?? row.email,
    cohortName: run.name,
    organisation: run.organisation,
    link: `${baseUrl(c.env)}/t/${token}`,
  });
  await sendMail(c.env, { to: row.email, kind: 'collab_invite', ...mail });

  return c.json({ ok: true, email: row.email });
});

// ----------------------------------------------------------------- trend

collabRunRoutes.get('/:id/trend', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const names = new Map(COLLAB_SECTIONS.map((s) => [s.key, s.short]));
  return c.json(await collabTrend(c.env, run.id, names));
});

// --------------------------------------------------------------- invitations

/**
 * Invites named people to a run, one personal link each.
 *
 * Refused outright for an anonymous run. A personal link is a door with
 * somebody's name on it, and the response that comes through it is reachable
 * from that door: issuing one in a run promised as anonymous would make every
 * answer joinable back to a person, whatever the console chose to display. An
 * anonymous run is shared as one link, and chasing it means chasing everybody.
 */
collabRunRoutes.post('/:id/invites', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.anonymous === 1) {
    return c.json(
      {
        error:
          'This run is anonymous, so it cannot send a personal link to a named person — that link would tie their answers back to them. Share the run\'s link with the group instead.',
      },
      409,
    );
  }
  if (run.status !== 'open') {
    return c.json({ error: 'Open the run before inviting anyone to it.' }, 409);
  }

  const parsed = collabInviteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the addresses.', details: fieldErrors(parsed.error) }, 400);
  }

  const wave = await c.env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(run.id)
    .first<{ no: number }>();
  if (!wave) return c.json({ error: 'This run has no wave to invite to.' }, 409);

  const branding = brandingFrom(await getSettings(c.env));
  const logoUrl = `${baseUrl(c.env)}/api/logo`;
  const sent: string[] = [];
  const skipped: string[] = [];

  for (const person of parsed.data.people) {
    const email = person.email;
    // Already invited to this wave: the link they hold still works, and a
    // second one would silently retire it mid-exercise.
    const existing = await c.env.DB.prepare(
      `SELECT l.id FROM links l
         JOIN candidates cd ON cd.id = l.candidate_id
        WHERE l.cohort_id = ?1 AND l.round_no = ?2 AND l.kind = 'personal'
          AND l.self_issued = 0 AND l.active = 1 AND cd.email = ?3`,
    )
      .bind(run.id, wave.no, email)
      .first<{ id: string }>();
    if (existing) {
      skipped.push(email);
      continue;
    }

    let candidate = await c.env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
      .bind(email)
      .first<{ id: string }>();
    if (!candidate) {
      const id = newId('cand');
      await c.env.DB.prepare(
        `INSERT INTO candidates (id, email, first_name, last_name, organisation)
         VALUES (?1, ?2, ?3, '', ?4)`,
      )
        .bind(id, email, person.name, run.organisation)
        .run();
      candidate = { id };
    } else if (person.name !== '') {
      await c.env.DB.prepare('UPDATE candidates SET first_name = ?2 WHERE id = ?1')
        .bind(candidate.id, person.name)
        .run();
    }

    /*
     * The run's own roster row: who this person is *here*. Their department
     * belongs to the run rather than to the person — someone can move between
     * departments, and last year's wave should keep saying where they were
     * when they answered it.
     */
    await upsertMember(c.env, run.id, email, person.name, person.department);

    const token = generateToken();
    await c.env.DB.prepare(
      `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, cohort_id, round_no, active, self_issued)
       VALUES (?1, ?2, 'personal', ?3, ?4, ?5, ?6, 1, 0)`,
    )
      .bind(
        newId('lnk'),
        await hashToken(token, c.env.LINK_TOKEN_SECRET),
        ASSESSMENT_ID.collab,
        candidate.id,
        run.id,
        wave.no,
      )
      .run();

    const mail = magicLinkEmail({
      branding,
      logoUrl,
      name: email.split('@')[0] ?? email,
      cohortName: run.name,
      organisation: run.organisation,
      link: `${baseUrl(c.env)}/t/${token}`,
    });
    await sendMail(c.env, { to: email, kind: 'collab_invite', ...mail });
    sent.push(email);
  }

  return c.json({ sent: sent.length, skipped: skipped.length, wave: wave.no });
});

/**
 * Reminds the people who have not finished.
 *
 * The link they were sent is not reissued: it still works, and replacing it
 * mid-exercise would break the half-finished sheet they can currently return
 * to. This is the same door, knocked on again.
 */
collabRunRoutes.post('/:id/remind', async (c) => {
  const run = await loadRun(c.env, c.req.param('id'));
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.anonymous === 1) {
    return c.json(
      {
        error:
          'This run is anonymous, so there is no way to tell who has answered and nobody to chase. Send the run\'s link to the group again.',
      },
      409,
    );
  }

  const wave = await c.env.DB.prepare(
    'SELECT no FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1',
  )
    .bind(run.id)
    .first<{ no: number }>();
  if (!wave) return c.json({ error: 'This run has no wave to remind about.' }, 409);

  /*
   * Everyone invited to this wave whose response is not complete. A link with
   * no response at all has not been opened; one with an unfinished response
   * was started and abandoned. Both get the same nudge — the difference
   * matters to the facilitator, not to the person being reminded.
   */
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, cd.email
       FROM links l
       JOIN candidates cd ON cd.id = l.candidate_id
      WHERE l.cohort_id = ?1 AND l.round_no = ?2 AND l.kind = 'personal'
        AND l.self_issued = 0 AND l.active = 1
        AND NOT EXISTS (
          SELECT 1 FROM responses r
           WHERE r.link_id = l.id AND r.status = 'completed'
        )`,
  )
    .bind(run.id, wave.no)
    .all<{ id: string; email: string }>();

  const outstanding = results ?? [];
  if (outstanding.length === 0) {
    return c.json({ reminded: 0, message: 'Everyone invited to this wave has finished.' });
  }

  const branding = brandingFrom(await getSettings(c.env));
  const logoUrl = `${baseUrl(c.env)}/api/logo`;

  for (const row of outstanding) {
    /*
     * Only a hash of the original token was kept, so the reminder cannot
     * repeat the link that was sent. It rotates the token *on the same link
     * row* instead: the row's id is what a half-finished response is attached
     * to, so the new token opens the same sheet at the same statement, and the
     * old one stops working — which is the right outcome for a link that has
     * been sitting in an inbox for a fortnight.
     */
    const token = generateToken();
    await c.env.DB.prepare('UPDATE links SET token_hash = ?2, active = 1 WHERE id = ?1')
      .bind(row.id, await hashToken(token, c.env.LINK_TOKEN_SECRET))
      .run();

    const mail = magicLinkEmail({
      branding,
      logoUrl,
      name: row.email.split('@')[0] ?? row.email,
      cohortName: run.name,
      organisation: run.organisation,
      link: `${baseUrl(c.env)}/t/${token}`,
    });
    await sendMail(c.env, {
      to: row.email,
      kind: 'collab_reminder',
      subject: `${run.name} — a reminder to finish`,
      html: mail.html,
      text: mail.text,
    });
  }

  return c.json({ reminded: outstanding.length, wave: wave.no });
});

/**
 * The run's roster row for one address, created or corrected.
 *
 * `cohort_members` already models "a person in this group" — sociometry uses
 * `no` as a rating address, which this instrument never does, so the row here
 * is just a name, a department and an email scoped to the run.
 */
async function upsertMember(
  env: Env,
  cohortId: string,
  email: string,
  name: string,
  department: string | undefined,
): Promise<void> {
  const existing = await env.DB.prepare(
    'SELECT id FROM cohort_members WHERE cohort_id = ?1 AND email = ?2',
  )
    .bind(cohortId, email)
    .first<{ id: string }>();

  if (existing) {
    if (name !== '') {
      await env.DB.prepare('UPDATE cohort_members SET name = ?2 WHERE id = ?1')
        .bind(existing.id, name)
        .run();
    }
    if (department !== undefined) {
      await env.DB.prepare('UPDATE cohort_members SET function = ?2 WHERE id = ?1')
        .bind(existing.id, department)
        .run();
    }
    return;
  }

  const next = await env.DB.prepare(
    'SELECT COALESCE(MAX(no), 0) + 1 AS no FROM cohort_members WHERE cohort_id = ?1',
  )
    .bind(cohortId)
    .first<{ no: number }>();

  await env.DB.prepare(
    `INSERT INTO cohort_members (id, cohort_id, no, name, function, email, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)`,
  )
    .bind(newId('mem'), cohortId, next?.no ?? 1, name || email, department ?? '', email)
    .run();
}

/** Reminder offsets, tolerant of a column that predates them. */
export function safeDays(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is number => Number.isInteger(v) && v > 0) : [];
  } catch {
    return [];
  }
}

function safeOptions(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
