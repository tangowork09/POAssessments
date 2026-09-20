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
 * Nothing here returns an individual's answers. There is no route for it — not
 * a guarded one, not an admin-only one. A diagnostic with fifty respondents is
 * answered honestly because nobody can be read individually, and the cheapest
 * way to keep that true is to never build the endpoint.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { requireAdmin, type AdminHono } from '../lib/auth.js';
import { auditAll } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { ASSESSMENT_ID } from '../../shared/assessments.js';
import { COLLAB_ITEMS, COLLAB_ITEM_COUNT, COLLAB_SECTIONS, COLLAB_SECTION_BY_KEY } from '../../shared/collab.js';
import { COLLAB_BANDS } from '../../shared/collab-scoring.js';
import {
  CollabRunError,
  runTurnout,
  scoreRun,
  type CollabRunScores,
} from '../lib/collab-run.js';
import { buildCollabWorkbook } from '../lib/collab-workbook.js';
import {
  collabFacetsSchema,
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
    `SELECT id, name, organisation, status, min_segment, anonymous, link_ttl_days,
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
            co.created_at, co.closed_at,
            COALESCE(${CURRENT_ROUND}, 1) AS round_no,
            (SELECT rd.label FROM cohort_rounds rd
              WHERE rd.cohort_id = co.id AND rd.no = COALESCE(${CURRENT_ROUND}, 1)) AS round_label,
            (SELECT COUNT(*) FROM cohort_rounds rd WHERE rd.cohort_id = co.id) AS wave_count,
            (SELECT COUNT(*) FROM responses r
              WHERE r.cohort_id = co.id AND r.round_no = COALESCE(${CURRENT_ROUND}, 1)
                AND r.status = 'completed') AS completed
       FROM cohorts co
      WHERE co.assessment_id = ?1
      ORDER BY co.created_at DESC`,
  )
    .bind(ASSESSMENT_ID.collab)
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
    const answered = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM responses
        WHERE cohort_id = ?1 AND status IN ('in_progress','completed')`,
    )
      .bind(run.id)
      .first<{ n: number }>();
    if ((answered?.n ?? 0) > 0) {
      return c.json(
        {
          error:
            'People have already answered under the current setting. Start a new wave to change how responses are stored.',
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

  return c.json({ ok: true });
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

  return c.json({ no: next }, 201);
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
  return c.json({
    run: { id: run.id, name: run.name, organisation: run.organisation, anonymous: run.anonymous === 1 },
    wave,
    minSegment: run.min_segment,
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

function safeOptions(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
