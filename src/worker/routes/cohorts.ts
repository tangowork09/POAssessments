/**
 * Cohort administration.
 *
 * A cohort is one run of a cohort instrument on one intact group. The console
 * builds the roster, opens the run, watches responses arrive, and generates the
 * reports; nothing here is reachable from the candidate shell.
 *
 * Roster positions are the addresses stored ratings point at, so the one rule
 * this file enforces above all others is that a position, once used, is never
 * reassigned to a different person.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { baseUrl } from '../env.js';
import { requireAdmin, type AdminHono } from '../lib/auth.js';
import { cellAt, readXlsx, sheetWidth, XlsxError, type XlsxSheet } from '../lib/xlsx-read.js';
import { auditAll, recordBefore } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { decodeImageDataUrl } from '../pdf/image.js';
import { renderInsightExportPdf } from '../pdf/insight-export.js';
import { dispatch } from '../pipeline.js';
import { sendMail } from '../lib/mailer.js';
import { brandingForClient } from '../lib/brand-asset.js';
import { magicLinkEmail } from '../email/templates.js';
import {
  assignmentsSetSchema,
  cohortCreateSchema,
  cohortUpdateSchema,
  fieldErrors,
  insightExportSchema,
  reportsToError,
  rosterMemberSchema,
  rosterPasteSchema,
  rosterSetSchema,
  cohortImportSchema,
  rosterUploadSchema,
} from '../lib/validation.js';
import {
  DEFAULT_LINK_TTL_DAYS,
  CohortError,
  type CohortRow,
  currentRound,
  generateCohortReports,
  loadCohort,
  loadCohortResponses,
  loadRoster,
  roundByNo,
  roundName,
  type RoundRow,
  scoreCohort,
} from '../lib/cohort.js';
import { buildCohortTrend } from '../lib/cohort-trend.js';
import { getBranding } from '../lib/settings.js';
import {
  COHORT_REPORT_SELECT,
  cohortPdfName,
  renderStoredCohortPdf,
  type CohortReportRow,
} from '../lib/cohort-report-render.js';
import { ASSESSMENT_ID } from '../../shared/assessments.js';
import { SOCIO_DEFAULT_MIN_RATERS } from '../../shared/socio.js';
import { cohortIdentityMode } from '../../shared/cohort-identity.js';
import { scoreSocioCohort, socioEdges } from '../../shared/socio-scoring.js';
import type { CohortDetail, CohortNetwork, CohortRoundSummary, CohortSummary } from '../../shared/types.js';

export const cohortRoutes = new Hono<AdminHono>();

cohortRoutes.use('*', auditAll);
cohortRoutes.use('*', requireAdmin);

// -------------------------------------------------------------------- listing

interface CohortListRow extends CohortRow {
  short_slug: string | null;
  slug_active: number;
  instrument_slug: string | null;
  roster_size: number;
  respondents: number;
  link_token: string | null;
  link_active: number | null;
  group_reports: number;
  member_reports: number;
  suppressed_reports: number;
  round_no: number;
  round_label: string | null;
  round_count: number;
}

/*
 * Every count here is scoped to the *current* round, because that is what the
 * console shows on a cohort at rest: how this wave is going. The history lives
 * on the detail view, one row per round, so an old wave's responses and reports
 * are never mixed into the current wave's numbers.
 */
const CURRENT_ROUND = `
  (SELECT rd.no FROM cohort_rounds rd
    WHERE rd.cohort_id = co.id
    ORDER BY (rd.closed_at IS NULL) DESC, rd.no DESC LIMIT 1)
`;

const LIST_SELECT = `
  SELECT co.*,
         (SELECT a.short_slug FROM assessments a WHERE a.id = co.assessment_id) AS instrument_slug,
         COALESCE(${CURRENT_ROUND}, 1) AS round_no,
         (SELECT rd.label FROM cohort_rounds rd
           WHERE rd.cohort_id = co.id AND rd.no = COALESCE(${CURRENT_ROUND}, 1)) AS round_label,
         (SELECT COUNT(*) FROM cohort_rounds rd WHERE rd.cohort_id = co.id) AS round_count,
         (SELECT COUNT(*) FROM cohort_members m
           WHERE m.cohort_id = co.id AND m.active = 1) AS roster_size,
         (SELECT COUNT(*) FROM responses r
           WHERE r.cohort_id = co.id AND r.status = 'completed'
             AND r.round_no = COALESCE(${CURRENT_ROUND}, 1)) AS respondents,
         (SELECT l.token_plain FROM links l
           WHERE l.cohort_id = co.id AND l.kind = 'generic'
             AND l.round_no = COALESCE(${CURRENT_ROUND}, 1) LIMIT 1) AS link_token,
         (SELECT l.active FROM links l
           WHERE l.cohort_id = co.id AND l.kind = 'generic'
             AND l.round_no = COALESCE(${CURRENT_ROUND}, 1) LIMIT 1) AS link_active,
         (SELECT COUNT(*) FROM cohort_reports cr
           WHERE cr.cohort_id = co.id AND cr.scope = 'group'
             AND cr.round_no = COALESCE(${CURRENT_ROUND}, 1)) AS group_reports,
         (SELECT COUNT(*) FROM cohort_reports cr
           WHERE cr.cohort_id = co.id AND cr.scope = 'member'
             AND cr.round_no = COALESCE(${CURRENT_ROUND}, 1)) AS member_reports,
         (SELECT COUNT(*) FROM cohort_reports cr
           WHERE cr.cohort_id = co.id AND cr.scope = 'member' AND cr.suppressed = 1
             AND cr.round_no = COALESCE(${CURRENT_ROUND}, 1)) AS suppressed_reports
    FROM cohorts co
   WHERE co.assessment_id = '{SOCIO}'
`.replace('{SOCIO}', ASSESSMENT_ID.socio);

function toSummary(row: CohortListRow): CohortSummary {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    name: row.name,
    organisation: row.organisation,
    status: row.status,
    minRaters: row.min_raters,
    tieThreshold: row.tie_threshold,
    minRatedTargets: row.min_rated_targets,
    linkTtlDays: row.link_ttl_days ?? DEFAULT_LINK_TTL_DAYS,
    shareReports: row.share_reports === 1,
    otpRequired: row.otp_required === 1,
    linkOnlyIdentity: row.link_only_identity === 1,
    shortSlug: row.short_slug,
    slugActive: row.slug_active === 1,
    // The alias is namespaced by the instrument — `/sociometry/acme-2026` — so
    // the console cannot build the URL from the cohort alone.
    instrumentSlug: row.instrument_slug,
    rosterSize: row.roster_size,
    respondents: row.respondents,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    linkToken: row.link_token,
    linkActive: row.link_active === 1,
    reports: {
      group: row.group_reports > 0,
      members: row.member_reports,
      suppressed: row.suppressed_reports,
    },
    roundNo: row.round_no,
    roundName: roundName({ no: row.round_no, label: row.round_label ?? '' }),
    roundCount: row.round_count,
  };
}

/** One row per wave, with the link, the count and the reports that belong to it. */
async function roundSummaries(env: Env, cohortId: string): Promise<CohortRoundSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT rd.no, rd.label, rd.opened_at, rd.closed_at,
            (SELECT l.token_plain FROM links l
              WHERE l.cohort_id = rd.cohort_id AND l.kind = 'generic'
                AND l.round_no = rd.no LIMIT 1) AS link_token,
            (SELECT l.active FROM links l
              WHERE l.cohort_id = rd.cohort_id AND l.kind = 'generic'
                AND l.round_no = rd.no LIMIT 1) AS link_active,
            (SELECT COUNT(*) FROM responses r
              WHERE r.cohort_id = rd.cohort_id AND r.round_no = rd.no
                AND r.status = 'completed') AS respondents,
            (SELECT COUNT(*) FROM cohort_reports cr
              WHERE cr.cohort_id = rd.cohort_id AND cr.round_no = rd.no
                AND cr.scope = 'group') AS group_reports,
            (SELECT COUNT(*) FROM cohort_reports cr
              WHERE cr.cohort_id = rd.cohort_id AND cr.round_no = rd.no
                AND cr.scope = 'member') AS member_reports,
            (SELECT COUNT(*) FROM cohort_reports cr
              WHERE cr.cohort_id = rd.cohort_id AND cr.round_no = rd.no
                AND cr.scope = 'member' AND cr.suppressed = 1) AS suppressed_reports
       FROM cohort_rounds rd
      WHERE rd.cohort_id = ?1
      ORDER BY rd.no`,
  )
    .bind(cohortId)
    .all<{
      no: number;
      label: string;
      opened_at: string;
      closed_at: string | null;
      link_token: string | null;
      link_active: number | null;
      respondents: number;
      group_reports: number;
      member_reports: number;
      suppressed_reports: number;
    }>();

  return (results ?? []).map((r) => ({
    no: r.no,
    label: r.label,
    name: roundName(r),
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    linkToken: r.link_token,
    linkActive: r.link_active === 1,
    respondents: r.respondents,
    reports: {
      group: r.group_reports > 0,
      members: r.member_reports,
      suppressed: r.suppressed_reports,
    },
  }));
}

cohortRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`${LIST_SELECT} ORDER BY co.created_at DESC`).all<CohortListRow>();
  return c.json({ cohorts: (results ?? []).map(toSummary) });
});

cohortRoutes.get('/:id', async (c) => {
  const row = await c.env.DB.prepare(`${LIST_SELECT} AND co.id = ?1`)
    .bind(c.req.param('id'))
    .first<CohortListRow>();
  if (!row) return c.json({ error: 'Cohort not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.no, m.name, m.function, m.email, m.active, m.tenure_band, m.reports_to,
            EXISTS (SELECT 1 FROM responses r
                     WHERE r.cohort_id = m.cohort_id AND r.rater_member_id = m.id
                       AND r.round_no = ?2 AND r.status = 'completed') AS responded
       FROM cohort_members m
      WHERE m.cohort_id = ?1
      ORDER BY m.no`,
  )
    .bind(row.id, row.round_no)
    .all<{
      id: string;
      no: number;
      name: string;
      function: string;
      email: string;
      active: number;
      tenure_band: string | null;
      reports_to: number | null;
      responded: number;
    }>();

  // Scoped to the current round, like every other count on this view: a link
  // belongs to the wave it was issued for, so September's links are not a way
  // into October's asking and must not be counted as one.
  const personalLinks = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM links
      WHERE cohort_id = ?1 AND kind = 'personal' AND round_no = ?2 AND active = 1`,
  )
    .bind(row.id, row.round_no)
    .first<{ n: number }>();

  const detail: CohortDetail = {
    ...toSummary(row),
    personalLinkCount: personalLinks?.n ?? 0,
    rounds: await roundSummaries(c.env, row.id),
    roster: (results ?? []).map((m) => ({
      memberId: m.id,
      no: m.no,
      name: m.name,
      func: m.function,
      email: m.email,
      active: m.active === 1,
      responded: m.responded === 1,
      // Null on every roster built before migration 0018, and null is the
      // answer the console draws as "—". Never coerced to a band or a zero.
      tenureBand: m.tenure_band,
      reportsTo: m.reports_to,
    })),
  };
  return c.json(detail);
});

// ------------------------------------------------------------------- lifecycle

cohortRoutes.post('/', async (c) => {
  const parsed = cohortCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;
  const id = newId('coh');

  await c.env.DB.prepare(
    `INSERT INTO cohorts (id, assessment_id, name, organisation, status, min_raters, tie_threshold, min_rated_targets)
     VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7)`,
  )
    .bind(id, ASSESSMENT_ID.socio, d.name, d.organisation, d.minRaters, d.tieThreshold, d.minRatedTargets)
    .run();

  // Every cohort starts with round 1. A cohort without a round has responses
  // that belong to nothing, so it is created with the cohort rather than lazily.
  await c.env.DB.prepare('INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, 1, ?3)')
    .bind(newId('crd'), id, '')
    .run();

  return c.json({ id }, 201);
});

cohortRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const parsed = cohortUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;

  // Opening a cohort with nobody on the roster produces a link that leads to an
  // empty exercise, which reads to a respondent as a broken link.
  if (d.status === 'open') {
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ?1 AND active = 1',
    )
      .bind(id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) < 2) {
      return c.json(
        { error: 'Add at least two people to the roster before opening this cohort — there is nobody to rate otherwise.' },
        400,
      );
    }
  }

  if (d.shortSlug) {
    // A cohort alias lives under its instrument (`/sociometry/acme-2026`), so
    // it cannot shadow one of the app's own routes and does not compete with
    // the instrument aliases. What it must still be is unique among the cohorts
    // of that instrument, or the two-segment path is ambiguous.
    const taken = await c.env.DB.prepare(
      `SELECT 1 AS hit FROM cohorts
        WHERE short_slug = ?1 AND id != ?2 AND assessment_id = ?3`,
    )
      .bind(d.shortSlug, id, cohort.assessment_id)
      .first<{ hit: number }>();
    if (taken) {
      return c.json(
        {
          error: `"${d.shortSlug}" is already in use. Pick another.`,
          details: { shortSlug: 'Already in use' },
        },
        409,
      );
    }
  }

  await c.env.DB.prepare(
    `UPDATE cohorts
        SET name              = COALESCE(?2, name),
            organisation      = COALESCE(?3, organisation),
            status            = COALESCE(?4, status),
            min_raters        = COALESCE(?5, min_raters),
            tie_threshold     = COALESCE(?6, tie_threshold),
            min_rated_targets = COALESCE(?7, min_rated_targets),
            -- '' clears the alias; absent leaves it alone.
            short_slug        = CASE WHEN ?8 IS NULL THEN short_slug
                                     WHEN ?8 = '' THEN NULL
                                     ELSE ?8 END,
            slug_active       = COALESCE(?9, slug_active),
            share_reports     = COALESCE(?10, share_reports),
            otp_required      = COALESCE(?11, otp_required),
            -- Absent leaves it alone, which is what puts the two identity flags
            -- beside each other rather than into one column: switching to
            -- personal links says nothing about the code requirement, so the
            -- stored one is still there to come back to. See migration 0019.
            link_only_identity = COALESCE(?12, link_only_identity),
            link_ttl_days     = COALESCE(?13, link_ttl_days),
            closed_at         = CASE WHEN ?4 = 'closed' THEN datetime('now')
                                     WHEN ?4 IS NOT NULL THEN NULL
                                     ELSE closed_at END
      WHERE id = ?1`,
  )
    .bind(
      id,
      d.name ?? null,
      d.organisation ?? null,
      d.status ?? null,
      d.minRaters ?? null,
      d.tieThreshold ?? null,
      d.minRatedTargets ?? null,
      d.shortSlug ?? null,
      d.slugActive === undefined ? null : d.slugActive ? 1 : 0,
      d.shareReports === undefined ? null : d.shareReports ? 1 : 0,
      d.otpRequired === undefined ? null : d.otpRequired ? 1 : 0,
      d.linkOnlyIdentity === undefined ? null : d.linkOnlyIdentity ? 1 : 0,
      d.linkTtlDays ?? null,
    )
    .run();

  // Who is allowed to answer as whom is the one cohort setting whose weakening
  // is worth a line of its own in the log. The automatic entry records that a
  // PATCH happened; this records which door was opened or shut, and what the
  // cohort was set to before — the question asked after the fact is never "was
  // this changed" but "when did it stop being link-only, and by whom".
  if (d.otpRequired !== undefined || d.linkOnlyIdentity !== undefined) {
    const was = cohortIdentityMode({
      otpRequired: cohort.otp_required === 1,
      linkOnlyIdentity: cohort.link_only_identity === 1,
    });
    const now = cohortIdentityMode({
      otpRequired: d.otpRequired ?? cohort.otp_required === 1,
      linkOnlyIdentity: d.linkOnlyIdentity ?? cohort.link_only_identity === 1,
    });
    if (was !== now) {
      recordBefore(c, {
        action: 'cohort.identity_mode',
        entity: 'cohort',
        entityId: id,
        summary: `Identity for "${cohort.name}" changed from ${was} to ${now}.`,
        before: { mode: was, otpRequired: cohort.otp_required === 1, linkOnlyIdentity: cohort.link_only_identity === 1 },
        after: {
          mode: now,
          otpRequired: d.otpRequired ?? cohort.otp_required === 1,
          linkOnlyIdentity: d.linkOnlyIdentity ?? cohort.link_only_identity === 1,
        },
      });
    }
  }

  // Closing the exercise closes the wave that was taking responses; opening it
  // again reopens that same wave rather than starting a new one, which is what
  // "I closed it by mistake" means. Starting a new wave is its own action.
  if (d.status === 'closed') {
    await c.env.DB.prepare(
      `UPDATE cohort_rounds SET closed_at = datetime('now')
        WHERE cohort_id = ?1 AND closed_at IS NULL`,
    )
      .bind(id)
      .run();
  } else if (d.status === 'open') {
    const latest = await currentRound(c.env, id);
    if (latest?.closed_at) {
      await c.env.DB.prepare('UPDATE cohort_rounds SET closed_at = NULL WHERE id = ?1')
        .bind(latest.id)
        .run();
    }
  }

  return c.json({ ok: true });
});

/**
 * Deleting a cohort takes its roster, responses and reports with it. Refused
 * once anyone has submitted: at that point the cohort is somebody's data, and
 * an accidental click in a list should not be able to destroy it. Close it
 * instead.
 */
cohortRoutes.delete('/:id', async (c) => {
  {
    // A cohort takes its roster, responses and reports with it. What the log
    // keeps is enough to know what was lost and to ask for it back from a
    // backup: the settings, the roster, and the links that reached it.
    const id = c.req.param('id');
    const before = await c.env.DB.prepare('SELECT * FROM cohorts WHERE id = ?1')
      .bind(id)
      .first<Record<string, unknown>>();
    if (before) {
      const roster = await c.env.DB.prepare(
        'SELECT no, name, function, email, active, tenure_band, reports_to FROM cohort_members WHERE cohort_id = ?1 ORDER BY no',
      )
        .bind(id)
        .all<Record<string, unknown>>();
      const links = await c.env.DB.prepare(
        'SELECT round_no, kind, token_plain, active FROM links WHERE cohort_id = ?1',
      )
        .bind(id)
        .all<Record<string, unknown>>();
      recordBefore(c, {
        action: 'cohort.delete',
        entity: 'cohort',
        entityId: id,
        summary: `Deleted the cohort "${String(before.name)}" and everything attached to it.`,
        before: { cohort: before, roster: roster.results ?? [], links: links.results ?? [] },
      });
    }
  }
  const id = c.req.param('id');
  const responses = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM responses WHERE cohort_id = ?1 AND status != 'invited'",
  )
    .bind(id)
    .first<{ n: number }>();

  if ((responses?.n ?? 0) > 0) {
    return c.json(
      { error: 'People have already started this exercise, so it cannot be deleted. Close it instead.' },
      409,
    );
  }

  await c.env.DB.prepare('DELETE FROM cohorts WHERE id = ?1').bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------- roster

/**
 * Replaces the roster.
 *
 * Positions are matched by name, and a matched person keeps the position they
 * already had. That is not a nicety: `no` is what every stored rating points
 * at, so renumbering a roster mid-run would silently transfer ratings from one
 * person to another. Anyone dropped from the list is deactivated rather than
 * deleted, leaving their position permanently spoken for.
 */
cohortRoutes.put('/:id/roster', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const parsed = rosterSetSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the roster.', details: fieldErrors(parsed.error) }, 400);
  }

  const incoming = parsed.data.members;
  const seen = new Set<string>();
  for (const m of incoming) {
    const key = m.name.trim().toLowerCase();
    if (seen.has(key)) {
      return c.json(
        { error: `"${m.name}" appears twice. Each person needs a distinct name, since that is how respondents identify themselves.` },
        400,
      );
    }
    seen.add(key);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT id, no, name FROM cohort_members WHERE cohort_id = ?1 ORDER BY no',
  )
    .bind(id)
    .all<{ id: string; no: number; name: string }>();
  const existing = results ?? [];
  const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m]));

  // Positions are settled before anything is validated or written, because a
  // reporting line points at a position and half of them may be positions this
  // very request is about to create.
  let nextNo = existing.reduce((max, m) => Math.max(max, m.no), 0);
  const planned = incoming.map((m) => {
    const match = byName.get(m.name.trim().toLowerCase());
    if (match) return { row: m, no: match.no, id: match.id, isNew: false };
    nextNo += 1;
    return { row: m, no: nextNo, id: newId('cmem'), isNew: true };
  });

  // Every position on the cohort, not just the ones in this payload: a member
  // dropped from the list is deactivated rather than deleted, so their position
  // still exists and a line drawn to it still means something.
  const rosterNos = new Set<number>([...existing.map((m) => m.no), ...planned.map((p) => p.no)]);
  for (const p of planned) {
    const problem = reportsToError(p.row.reportsTo, p.no, rosterNos);
    if (problem) return c.json({ error: `${p.row.name}: ${problem}` }, 400);
  }

  const statements = [];
  const keptIds = new Set<string>();

  for (const p of planned) {
    const m = p.row;
    // Absent is not the same as null here. A paste or a spreadsheet carries
    // three columns and says nothing about tenure or reporting line, so a
    // roster replace from either must leave the attributes a facilitator typed
    // in by hand exactly where they are rather than wiping them.
    const setTenure = m.tenureBand === undefined ? 0 : 1;
    const setReports = m.reportsTo === undefined ? 0 : 1;
    keptIds.add(p.id);
    if (!p.isNew) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE cohort_members
              SET function = ?2, email = ?3, active = 1,
                  tenure_band = CASE WHEN ?4 = 1 THEN ?5 ELSE tenure_band END,
                  reports_to  = CASE WHEN ?6 = 1 THEN ?7 ELSE reports_to  END
            WHERE id = ?1`,
        ).bind(p.id, m.func, m.email, setTenure, m.tenureBand ?? null, setReports, m.reportsTo ?? null),
      );
    } else {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO cohort_members (id, cohort_id, no, name, function, email, active, tenure_band, reports_to)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)`,
        ).bind(p.id, id, p.no, m.name, m.func, m.email, m.tenureBand ?? null, m.reportsTo ?? null),
      );
    }
  }

  for (const m of existing) {
    if (!keptIds.has(m.id)) {
      statements.push(
        c.env.DB.prepare('UPDATE cohort_members SET active = 0 WHERE id = ?1').bind(m.id),
      );
    }
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, size: incoming.length });
});

/**
 * Parses a pasted roster without saving it, so the console can show what it
 * understood before anything is committed. Accepts `Name, Function, email` per
 * line, with tabs as an alternative separator for a paste straight out of a
 * spreadsheet.
 */
cohortRoutes.post('/:id/roster/parse', async (c) => {
  const parsed = rosterPasteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Nothing to read.' }, 400);

  const rows: { name: string; func: string; email: string }[] = [];
  const skipped: string[] = [];

  for (const raw of parsed.data.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(line.includes('\t') ? '\t' : ',').map((p) => p.trim());
    const name = parts[0] ?? '';
    if (!name) {
      skipped.push(raw);
      continue;
    }
    // A header row pasted along with the data is the most common first mistake.
    if (/^(name|leader|leader name)$/i.test(name)) continue;
    rows.push({ name, func: parts[1] ?? '', email: (parts[2] ?? '').toLowerCase() });
  }

  return c.json({ rows, skipped });
});

/** Adds one person to the end of the roster. */
cohortRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const parsed = rosterMemberSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;

  const clash = await c.env.DB.prepare(
    'SELECT id FROM cohort_members WHERE cohort_id = ?1 AND active = 1 AND lower(name) = lower(?2)',
  )
    .bind(id, d.name)
    .first<{ id: string }>();
  if (clash) {
    return c.json(
      {
        error: `"${d.name}" is already on this roster. Respondents identify themselves by name, so each one has to be distinct.`,
        details: { name: 'Already on the roster' },
      },
      409,
    );
  }

  // Positions are the addresses stored ratings point at, so a new member takes
  // the next one rather than filling a gap a removed member left behind.
  const { results: nos } = await c.env.DB.prepare(
    'SELECT no FROM cohort_members WHERE cohort_id = ?1',
  )
    .bind(id)
    .all<{ no: number }>();
  const rosterNos = new Set((nos ?? []).map((r) => r.no));
  const nextNo = (nos ?? []).reduce((max, r) => Math.max(max, r.no), 0) + 1;

  // The new position is not in `rosterNos`, so a line drawn to it is refused as
  // a position that does not exist — which is what self-reference looks like
  // for someone who is not on the roster yet.
  const problem = reportsToError(d.reportsTo, nextNo, rosterNos);
  if (problem) return c.json({ error: problem, details: { reportsTo: problem } }, 400);

  const memberId = newId('cmem');
  await c.env.DB.prepare(
    `INSERT INTO cohort_members (id, cohort_id, no, name, function, email, active, tenure_band, reports_to)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)`,
  )
    .bind(memberId, id, nextNo, d.name, d.func, d.email, d.tenureBand ?? null, d.reportsTo ?? null)
    .run();

  return c.json({ id: memberId, no: nextNo }, 201);
});

/**
 * Edits one person in place.
 *
 * Their roster position is untouched, so every rating already given about them
 * stays attached — a name is a label here, the position is the identity.
 */
cohortRoutes.patch('/:id/members/:memberId', async (c) => {
  const id = c.req.param('id');
  const memberId = c.req.param('memberId');

  const parsed = rosterMemberSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;

  const member = await c.env.DB.prepare(
    'SELECT id, no, name FROM cohort_members WHERE id = ?1 AND cohort_id = ?2',
  )
    .bind(memberId, id)
    .first<{ id: string; no: number; name: string }>();
  if (!member) return c.json({ error: 'That person is not on this roster.' }, 404);

  if (d.reportsTo !== undefined) {
    const { results: nos } = await c.env.DB.prepare(
      'SELECT no FROM cohort_members WHERE cohort_id = ?1',
    )
      .bind(id)
      .all<{ no: number }>();
    const problem = reportsToError(d.reportsTo, member.no, new Set((nos ?? []).map((r) => r.no)));
    if (problem) return c.json({ error: problem, details: { reportsTo: problem } }, 400);
  }

  if (d.name && d.name.toLowerCase() !== member.name.toLowerCase()) {
    const clash = await c.env.DB.prepare(
      `SELECT id FROM cohort_members
        WHERE cohort_id = ?1 AND active = 1 AND lower(name) = lower(?2) AND id != ?3`,
    )
      .bind(id, d.name, memberId)
      .first<{ id: string }>();
    if (clash) {
      return c.json(
        { error: `"${d.name}" is already on this roster.`, details: { name: 'Already on the roster' } },
        409,
      );
    }
  }

  // COALESCE says "an omitted field keeps its stored value", which is right for
  // the three fields above: none of them has a meaningful null, so null can
  // stand in for "not supplied". Tenure and reporting line do have one — "not
  // recorded" is the answer for most rosters — so clearing one has to be
  // expressible, and COALESCE cannot tell a clear from an omission. The flag
  // pairs below carry that distinction explicitly.
  const setTenure = d.tenureBand === undefined ? 0 : 1;
  const setReports = d.reportsTo === undefined ? 0 : 1;

  await c.env.DB.prepare(
    `UPDATE cohort_members
        SET name        = COALESCE(?2, name),
            function    = COALESCE(?3, function),
            email       = COALESCE(?4, email),
            tenure_band = CASE WHEN ?5 = 1 THEN ?6 ELSE tenure_band END,
            reports_to  = CASE WHEN ?7 = 1 THEN ?8 ELSE reports_to  END
      WHERE id = ?1`,
  )
    .bind(
      memberId,
      d.name ?? null,
      d.func ?? null,
      d.email ?? null,
      setTenure,
      d.tenureBand ?? null,
      setReports,
      d.reportsTo ?? null,
    )
    .run();

  return c.json({ ok: true });
});

/**
 * Takes someone off the roster.
 *
 * Deactivated rather than deleted once anybody has answered anything in this
 * cohort: their position is an address that stored ratings point at, and
 * freeing it would let a later member inherit ratings meant for them. Before
 * the first answer there is nothing pointing anywhere, so the row goes properly
 * and the numbering stays tidy.
 */
cohortRoutes.delete('/:id/members/:memberId', async (c) => {
  {
    const row = await c.env.DB.prepare(
      'SELECT id, no, name, function, email, active, tenure_band, reports_to FROM cohort_members WHERE id = ?1 AND cohort_id = ?2',
    )
      .bind(c.req.param('memberId'), c.req.param('id'))
      .first<Record<string, unknown>>();
    if (row) {
      recordBefore(c, {
        action: 'cohort.member.remove',
        entity: 'cohort',
        entityId: c.req.param('id'),
        summary: `Removed ${String(row.name)} (position ${String(row.no)}) from the roster.`,
        before: row,
      });
    }
  }
  const id = c.req.param('id');
  const memberId = c.req.param('memberId');

  const member = await c.env.DB.prepare(
    'SELECT id FROM cohort_members WHERE id = ?1 AND cohort_id = ?2',
  )
    .bind(memberId, id)
    .first<{ id: string }>();
  if (!member) return c.json({ error: 'That person is not on this roster.' }, 404);

  const answers = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM answers a
       JOIN responses r ON r.id = a.response_id
      WHERE r.cohort_id = ?1`,
  )
    .bind(id)
    .first<{ n: number }>();

  if ((answers?.n ?? 0) > 0) {
    await c.env.DB.prepare('UPDATE cohort_members SET active = 0 WHERE id = ?1').bind(memberId).run();
    return c.json({ ok: true, deactivated: true });
  }

  await c.env.DB.prepare('DELETE FROM cohort_members WHERE id = ?1').bind(memberId).run();
  return c.json({ ok: true, deactivated: false });
});

/** Puts a removed person back, keeping the position they always had. */
cohortRoutes.post('/:id/members/:memberId/restore', async (c) => {
  await c.env.DB.prepare(
    'UPDATE cohort_members SET active = 1 WHERE id = ?1 AND cohort_id = ?2',
  )
    .bind(c.req.param('memberId'), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

/**
 * Reads a roster out of an uploaded workbook.
 *
 * Parsed and handed straight back rather than saved, so the console can show
 * what it understood before anything is committed — the same contract as the
 * paste box. Name, function and email are taken from the first three columns,
 * or from columns whose header says so when the sheet has one.
 */
export interface ParsedWorkbook {
  rows: { name: string; func: string; email: string }[];
  skipped: string[];
  /** Cohort name / organisation found in label rows above the table, or ''. */
  meta: { name: string; organisation: string };
  /**
   * Who rates whom, when the workbook carries a sheet for it. Names as the
   * sheet spells them; the caller resolves them against the roster it just
   * made. Empty means "not supplied", which is the full matrix — everyone
   * rates everyone — and not "nobody rates anybody".
   */
  assignments: AssignmentPair[];
}

/**
 * Reads a roster — and, when the sheet carries them, the cohort's own name and
 * organisation — out of an uploaded workbook.
 *
 * Label rows may sit above the table: a first cell reading "Cohort",
 * "Group" or "Team" names the cohort, "Organisation" or "Company" names the
 * organisation, with the value beside it or after a colon in the same cell.
 * Those rows are consumed as metadata and never mistaken for people.
 *
 * A header row is optional. When one is present its wording decides which
 * column is which, so a sheet with the columns in another order still reads
 * correctly; without one the first three columns are taken in order.
 * Throws CohortError with a message fit to show the operator.
 */
/** One cell of a parsed sheet, 1-based, or '' past the end of the row. */
function cellString(sheet: XlsxSheet, rowNo: number, colNo: number): string {
  return cellAt(sheet, rowNo, colNo);
}

/** A rater and one person they are assigned, both as the sheet spells them. */
export interface AssignmentPair {
  rater: string;
  target: string;
}

/**
 * Reads "who rates whom" off one sheet, in whichever of the two shapes it is.
 *
 *   matrix — row 1 holds target names from column 2; column 1 holds rater
 *            names from row 2; any non-empty cell assigns that pair.
 *   list   — column 1 holds the rater, columns 2.. hold their targets.
 *
 * `knows` decides the shape: a matrix's first row is mostly roster names. It
 * takes names rather than ids so the same reader serves an upload against a
 * live roster and an import where the roster does not exist yet.
 */
function readAssignmentSheet(ws: XlsxSheet, knows: (name: string) => boolean): AssignmentPair[] {
  const pairs: AssignmentPair[] = [];
  const width = Math.min(sheetWidth(ws), 201);
  const headNames: string[] = [];
  for (let i = 2; i <= width; i++) {
    const t = cellString(ws, 1, i);
    if (t) headNames.push(t);
  }
  const hits = headNames.filter((t) => knows(t)).length;
  const isMatrix = headNames.length >= 2 && hits >= Math.ceil(headNames.length * 0.6);

  if (isMatrix) {
    const targetOfCol = new Map<number, string>();
    for (let i = 2; i <= width; i++) {
      const t = cellString(ws, 1, i);
      if (t) targetOfCol.set(i, t);
    }
    for (let rowNo = 2; rowNo <= ws.rows.length; rowNo++) {
      const rater = cellString(ws, rowNo, 1);
      if (!rater) continue;
      for (const [col, target] of targetOfCol) {
        if (cellString(ws, rowNo, col)) pairs.push({ rater, target });
      }
    }
    return pairs;
  }

  for (let rowNo = 1; rowNo <= ws.rows.length; rowNo++) {
    const first = cellString(ws, rowNo, 1);
    // A header like "Leader | Rates" is skipped, not treated as a person.
    if (rowNo === 1 && /^(name|leader|person|rater)s?\b/i.test(first) && !knows(first)) continue;
    if (!first) continue;
    for (let i = 2; i <= width; i++) {
      const t = cellString(ws, rowNo, i);
      if (t) pairs.push({ rater: first, target: t });
    }
  }
  return pairs;
}

/** Sheets that exist for the reader, never for the importer. */
const GUIDANCE_SHEET = /^(how to use|guide|guidance|instructions?|notes?|readme)\b/i;

export async function readRosterWorkbook(bytes: Uint8Array): Promise<ParsedWorkbook> {
  const rows: { name: string; func: string; email: string }[] = [];
  const skipped: string[] = [];
  const meta = { name: '', organisation: '' };

  let book: XlsxSheet[];
  try {
    book = await readXlsx(bytes);
  } catch (err) {
    throw new CohortError(
      err instanceof XlsxError
        ? err.message
        : 'That file is not a readable .xlsx workbook. Export it as Excel and try again.',
    );
  }
  // One workbook, one upload. A client filling this in should not have to send
  // three files and remember which screen each belongs to, so the roster and
  // the rating map travel as two sheets of the same book.
  //
  // Named sheets win; otherwise the first sheet that is not guidance is the
  // roster, which is what every workbook written before this looked like.
  const sheets = book.filter((w) => !GUIDANCE_SHEET.test(w.name.trim()));
  if (sheets.length === 0) throw new CohortError('That workbook has no sheets to read.');
  const named = (re: RegExp) => sheets.find((w) => re.test(w.name.trim()));
  // Not /matrix/: the client's own instrument calls its questionnaire tab
  // "Rating Matrix", and reading that as a map of who rates whom turned the
  // sheet's prose into a list of people nobody could find.
  const assignSheet = named(/assign|who rates|rates whom|rating map|mapping/i) ?? null;
  const ws = named(/roster|people|leaders?|members?|participants?/i)
    ?? sheets.find((w) => w !== assignSheet)
    ?? sheets[0]!;

  const cellText = (rowNo: number, i: number): string => cellString(ws, rowNo, i);

  // Where the table actually starts.
  //
  // A workbook a person designed rather than exported does not begin at A1. The
  // client's own instrument has an empty spacer column, a title, a note and a
  // blank row above its header — and taking row 1 / column A on faith read
  // fifty leaders as fifty blanks. So the sheet is scanned for its table
  // rather than assumed to be one.
  const width = Math.min(40, Math.max(3, sheetWidth(ws)));
  const rowIsEmpty = (rowNo: number): boolean => {
    for (let i = 1; i <= width; i++) if (cellText(rowNo, i)) return false;
    return true;
  };

  // Label rows, from the first row that says anything, stopping at the first
  // row that is neither a label nor blank. "Cohort name" starts with "Cohort",
  // so the label test runs before the header test ever sees the row.
  let scanRow = 1;
  for (; scanRow <= 12 && scanRow <= ws.rows.length; scanRow++) {
    if (rowIsEmpty(scanRow)) continue;
    let first = '';
    for (let i = 1; i <= width && !first; i++) first = cellText(scanRow, i);
    const isCohort = /^(cohort|group|team)\b/i.test(first);
    const isOrg = /^(organisation|organization|company|org)\b/i.test(first);
    if (!isCohort && !isOrg) break;
    // The value sits beside the label, or after a colon inside it.
    let value = '';
    for (let i = 1; i <= width; i++) {
      const t = cellText(scanRow, i);
      if (t && t !== first) { value = t; break; }
    }
    if (!value) value = first.split(':').slice(1).join(':').trim();
    if (isCohort && !meta.name) meta.name = value;
    if (isOrg && !meta.organisation) meta.organisation = value;
  }

  /**
   * Which of the three columns a heading names, if any.
   *
   * Order matters: "Leader name" is a name before it is anything else, and an
   * address column headed "Email" must not be read as a function because the
   * word "mail" appears nowhere in "department".
   */
  const roleOf = (text: string): 'name' | 'func' | 'mail' | null => {
    const t = text.toLowerCase();
    if (!t) return null;
    if (/name|leader|person|participant|member/.test(t)) return 'name';
    if (/mail/.test(t)) return 'mail';
    if (/function|department|dept|role|team|division|unit/.test(t)) return 'func';
    return null;
  };

  /**
   * The header row, chosen by how much of a header it looks like rather than
   * by position.
   *
   * A title row saying "Leader Roster" names one column by accident; the real
   * header two rows below names three on purpose. Scoring both and taking the
   * better one is what tells them apart — and an address in the row vetoes it
   * outright, because that is a person, not a heading.
   */
  let headerRow = 0;
  let headerScore = 0;
  const columnsOf = new Map<number, 'name' | 'func' | 'mail'>();
  for (let rowNo = scanRow; rowNo <= Math.min(scanRow + 14, ws.rows.length); rowNo++) {
    if (rowIsEmpty(rowNo)) continue;
    const found = new Map<number, 'name' | 'func' | 'mail'>();
    const seen = new Set<string>();
    let hasAddress = false;
    for (let i = 1; i <= width; i++) {
      const text = cellText(rowNo, i);
      if (text.includes('@')) hasAddress = true;
      const role = roleOf(text);
      if (!role || seen.has(role)) continue;
      seen.add(role);
      found.set(i, role);
    }
    if (hasAddress) continue;
    if (seen.size > headerScore) {
      headerScore = seen.size;
      headerRow = rowNo;
      columnsOf.clear();
      for (const [col, role] of found) columnsOf.set(col, role);
    }
  }

  let nameCol = 0;
  let funcCol = 0;
  let mailCol = 0;
  let firstDataRow = scanRow;

  if (headerScore >= 2 || (headerScore === 1 && columnsOf.values().next().value === 'name')) {
    firstDataRow = headerRow + 1;
    for (const [col, role] of columnsOf) {
      if (role === 'name') nameCol = col;
      else if (role === 'func') funcCol = col;
      else mailCol = col;
    }
  }

  // No header, or one that only named some of the columns: fall back to the
  // first columns that actually carry data, so a sheet with a spacer column
  // still lines up.
  if (nameCol === 0) {
    while (firstDataRow <= ws.rows.length && rowIsEmpty(firstDataRow)) firstDataRow += 1;
    const used: number[] = [];
    for (let i = 1; i <= width && used.length < 3; i++) {
      for (let rowNo = firstDataRow; rowNo <= Math.min(firstDataRow + 30, ws.rows.length); rowNo++) {
        if (cellText(rowNo, i)) { used.push(i); break; }
      }
    }
    nameCol = used[0] ?? 1;
    if (funcCol === 0) funcCol = used[1] ?? 0;
    if (mailCol === 0) mailCol = used[2] ?? 0;
  }

  const at = (rowNo: number, col: number): string => (col > 0 ? cellText(rowNo, col) : '');
  for (let rowNo = firstDataRow; rowNo <= ws.rows.length; rowNo++) {
    const name = at(rowNo, nameCol);
    if (!name) {
      if (at(rowNo, funcCol) || at(rowNo, mailCol)) skipped.push(`Row ${rowNo}: no name`);
      continue;
    }
    rows.push({ name, func: at(rowNo, funcCol), email: at(rowNo, mailCol).toLowerCase() });
  }

  // Read after the roster, so the shape test can ask whether a name in the
  // assignment sheet's header row is somebody the roster actually names.
  const rosterNames = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  const assignments =
    assignSheet && assignSheet !== ws
      ? readAssignmentSheet(assignSheet, (n) => rosterNames.has(n.trim().toLowerCase()))
      : [];

  return { rows, skipped, meta, assignments };
}

/**
 * Reads a roster out of an uploaded workbook.
 *
 * Parsed and handed straight back rather than saved, so the console can show
 * what it understood before anything is committed — the same contract as the
 * paste box.
 */
cohortRoutes.post('/:id/roster/upload', async (c) => {
  const parsed = rosterUploadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Nothing to read in that file.' }, 400);

  let bytes: Uint8Array;
  try {
    const base64 = parsed.data.fileBase64.replace(/^data:[^,]*,/, '');
    bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return c.json({ error: 'That file could not be read.' }, 400);
  }

  let book: ParsedWorkbook;
  try {
    book = await readRosterWorkbook(bytes);
  } catch (err) {
    return c.json({ error: err instanceof CohortError ? err.message : 'That file could not be read.' }, 400);
  }

  if (book.rows.length === 0) {
    return c.json({ error: "No names found. The first column should hold the leaders' names." }, 400);
  }

  return c.json({ rows: book.rows, skipped: book.skipped });
});

/**
 * One workbook in, one working cohort out.
 *
 * The upload route above parses and hands back; this one commits. It exists
 * for the operator who has the client's spreadsheet in hand and wants the
 * cohort made of it in one motion: cohort row, round 1 and roster, named from
 * the typed fields when given, else from label rows in the sheet, else from
 * the filename. The cohort lands as a draft — opening it, and issuing its
 * link, stay deliberate acts.
 */
cohortRoutes.post('/import', async (c) => {
  const parsed = cohortImportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Nothing to read in that file.' }, 400);
  const d = parsed.data;

  let bytes: Uint8Array;
  try {
    const base64 = d.fileBase64.replace(/^data:[^,]*,/, '');
    bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return c.json({ error: 'That file could not be read.' }, 400);
  }

  let book: ParsedWorkbook;
  try {
    book = await readRosterWorkbook(bytes);
  } catch (err) {
    return c.json({ error: err instanceof CohortError ? err.message : 'That file could not be read.' }, 400);
  }

  if (book.rows.length < 2) {
    return c.json(
      { error: 'A cohort needs at least two people. Check that the sheet holds the roster, one person per row, names in the first column.' },
      400,
    );
  }

  // The same rule the roster editor enforces, checked before anything is
  // created rather than after half of it is.
  const seen = new Set<string>();
  for (const m of book.rows) {
    const key = m.name.trim().toLowerCase();
    if (seen.has(key)) {
      return c.json(
        { error: `"${m.name}" appears twice in the sheet. Each person needs a distinct name, since that is how respondents identify themselves.` },
        400,
      );
    }
    seen.add(key);
  }

  const name =
    d.name || book.meta.name || d.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  if (!name) {
    return c.json({ error: 'Give the cohort a name — none was typed and none was found in the file.' }, 400);
  }
  const organisation = d.organisation || book.meta.organisation || '';

  const id = newId('coh');
  // Ids are minted before the batch so the assignment sheet can be resolved
  // against them in the same write: a cohort that arrives half-mapped is worse
  // than one that arrives unmapped.
  const memberIds = book.rows.map(() => newId('cmem'));
  const idByName = new Map(book.rows.map((m, i) => [m.name.trim().toLowerCase(), memberIds[i]!]));

  const unmatched = new Set<string>();
  const resolve = (raw: string): string | null => {
    const hit = idByName.get(raw.trim().toLowerCase());
    if (!hit && raw.trim()) unmatched.add(raw.trim());
    return hit ?? null;
  };
  const mapped = new Map<string, Set<string>>();
  for (const { rater, target } of book.assignments) {
    const a = resolve(rater);
    const b = resolve(target);
    if (!a || !b || a === b) continue; // self-ratings are dropped, never stored
    const set = mapped.get(a) ?? new Set<string>();
    set.add(b);
    mapped.set(a, set);
  }

  const statements = [
    // The rater floor is bound rather than left to the column default, so the
    // import path and the create form start a cohort on the same number and
    // there is one place to change it.
    c.env.DB.prepare(
      `INSERT INTO cohorts (id, assessment_id, name, organisation, status, min_raters)
       VALUES (?1, ?2, ?3, ?4, 'draft', ?5)`,
    ).bind(id, ASSESSMENT_ID.socio, name, organisation, SOCIO_DEFAULT_MIN_RATERS),
    c.env.DB.prepare('INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, 1, ?3)').bind(
      newId('crd'),
      id,
      '',
    ),
    ...book.rows.map((m, i) =>
      c.env.DB.prepare(
        `INSERT INTO cohort_members (id, cohort_id, no, name, function, email, active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)`,
      ).bind(memberIds[i]!, id, i + 1, m.name, m.func, m.email),
    ),
  ];
  let pairs = 0;
  for (const [rater, targets] of mapped) {
    for (const target of targets) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO cohort_assignments (id, cohort_id, rater_member_id, target_member_id)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(newId('casg'), id, rater, target),
      );
      pairs += 1;
    }
  }
  await c.env.DB.batch(statements);

  return c.json(
    {
      id,
      name,
      organisation,
      size: book.rows.length,
      skipped: book.skipped,
      // Absent assignments are the full matrix, so the console can say which
      // of the two a cohort arrived as rather than leaving the reader to open
      // the Access tab and count.
      // Nothing resolved means the sheet was not a rating map at all, and
      // reporting its prose as "names we could not find" reads as a fault in
      // the roster rather than as the absence of a map.
      assignments: {
        raters: mapped.size,
        pairs,
        unmatched: mapped.size === 0 ? [] : [...unmatched].slice(0, 30),
      },
    },
    201,
  );
});

/**
 * A network question as a PDF: the picture on one page, the standings as real
 * text on the next.
 *
 * The console sends what it is showing rather than the server re-deriving it —
 * the picture is an SVG laid out in the browser, and a second layout engine
 * producing a subtly different map would be worse than no map. The payload is
 * therefore display strings, and nothing here is scored.
 */
cohortRoutes.post('/:id/insight-pdf', async (c) => {
  const cohort = await loadCohort(c.env, c.req.param('id'));
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const parsed = insightExportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Nothing to put in the document.' }, 400);
  const d = parsed.data;

  const branding = await getBranding(c.env);
  const [picture, logo] = await Promise.all([
    d.imageDataUrl ? decodeImageDataUrl(d.imageDataUrl) : Promise.resolve(null),
    decodeImageDataUrl(branding.logoDataUrl),
  ]);

  const bytes = renderInsightExportPdf(
    {
      cohortName: cohort.name,
      organisation: cohort.organisation ?? '',
      round: d.round,
      tabTitle: d.tabTitle,
      question: d.question,
      finding: d.finding,
      imageDataUrl: d.imageDataUrl ?? null,
      columns: d.columns,
      rows: d.rows,
      panels: d.panels,
      generatedAt: new Date().toISOString(),
    },
    picture,
    logo,
  );

  const stem = `${cohort.name}-${d.tabTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return new Response(bytes as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${stem}.pdf"`,
    },
  });
});

// -------------------------------------------------------------------- network

/**
 * Everything the dashboard's network views draw, in one round trip: nodes,
 * every rated directed pair, the scored group result for the metrics panel,
 * and the assignment map. Computed live from the answers on every call — the
 * dashboard polls while a round is open, so what it shows is what has been
 * submitted, not what was last generated.
 *
 * Facilitator's eyes only (the whole router is behind requireAdmin): this is
 * the instrument's working surface, and none of it ever reaches a candidate.
 */
cohortRoutes.get('/:id/network', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const askedRound = Number(c.req.query('round') ?? '');
  const round = Number.isInteger(askedRound) && askedRound > 0
    ? await roundByNo(c.env, id, askedRound)
    : await currentRound(c.env, id);
  if (!round) return c.json({ error: 'That round does not exist.' }, 404);

  const [roster, responses, assignmentRows] = await Promise.all([
    loadRoster(c.env, id),
    loadCohortResponses(c.env, id, round.no),
    c.env.DB.prepare(
      'SELECT rater_member_id, target_member_id FROM cohort_assignments WHERE cohort_id = ?1',
    )
      .bind(id)
      .all<{ rater_member_id: string; target_member_id: string }>(),
  ]);

  const byRater = new Map<string, string[]>();
  for (const r of assignmentRows.results ?? []) {
    const list = byRater.get(r.rater_member_id) ?? [];
    list.push(r.target_member_id);
    byRater.set(r.rater_member_id, list);
  }

  const respondedNos = new Set(responses.map((r) => r.raterNo));

  // Scoring needs at least one response to say anything; the empty dashboard
  // is a state the client renders, not an error.
  let group = null;
  if (responses.length > 0) {
    group = scoreSocioCohort(
      roster.map((m) => ({ no: m.no, id: m.id, name: m.name, func: m.function })),
      responses,
      { minRaters: cohort.min_raters, tieThreshold: cohort.tie_threshold },
    );
  }

  const payload: CohortNetwork = {
    cohortId: id,
    roundNo: round.no,
    roundName: roundName(round),
    roundClosed: round.closed_at !== null,
    tieThreshold: cohort.tie_threshold,
    minRaters: cohort.min_raters,
    respondents: responses.length,
    rosterSize: roster.length,
    nodes: roster.map((m) => ({
      memberId: m.id,
      no: m.no,
      name: m.name,
      func: m.function,
      responded: respondedNos.has(m.no),
      // The two lenses the network is read through. Null on every cohort built
      // before migration 0018 and on every member nobody filled them in for,
      // so the views that use them have to have a "not recorded" case.
      tenureBand: m.tenure_band,
      reportsTo: m.reports_to,
    })),
    edges: socioEdges(responses, cohort.tie_threshold),
    group,
    assignments: [...byRater.entries()].map(([raterMemberId, targetMemberIds]) => ({
      raterMemberId,
      targetMemberIds,
    })),
  };
  return c.json(payload);
});

// ------------------------------------------------------------ member trend

/**
 * One member's positive-vs-negative ties received, across every round — the
 * per-person trend the ego panel draws. Polarity is derived the same way the
 * dashboard derives it: positive at or above the cohort tie threshold, cool at
 * or below 2.0 or when the deficit item is loud. Computed live per round so a
 * round still open contributes what it has so far.
 */
cohortRoutes.get('/:id/member/:no/trend', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const memberNo = Number(c.req.param('no'));
  if (!Number.isInteger(memberNo) || memberNo < 1) return c.json({ error: 'Bad member' }, 400);

  const { results: roundRows } = await c.env.DB.prepare(
    'SELECT no, label FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY no',
  )
    .bind(id)
    .all<{ no: number; label: string }>();

  const points = [];
  for (const r of roundRows ?? []) {
    const responses = await loadCohortResponses(c.env, id, r.no);
    const edges = socioEdges(responses, cohort.tie_threshold);
    let positive = 0;
    let negative = 0;
    for (const e of edges) {
      if (e.to !== memberNo) continue;
      const gapCool = e.gap !== null && e.gap.mean >= 4;
      if (e.n > 0 && e.mean >= cohort.tie_threshold) positive += 1;
      else if ((e.n > 0 && e.mean <= 2) || gapCool) negative += 1;
    }
    points.push({
      roundNo: r.no,
      roundName: r.label.trim() || `Round ${r.no}`,
      positive,
      negative,
    });
  }
  return c.json({ points });
});

// ---------------------------------------------------------------- assignments

/**
 * Who rates whom. No rows for a cohort means the full matrix — everyone rates
 * everyone, as before assignments existed. With rows, a rater who has them
 * sees exactly their targets; a rater without any still sees the whole roster
 * (see migration 0016 for why the fallback is generous).
 */
cohortRoutes.get('/:id/assignments', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT rater_member_id, target_member_id FROM cohort_assignments WHERE cohort_id = ?1`,
  )
    .bind(id)
    .all<{ rater_member_id: string; target_member_id: string }>();

  const byRater = new Map<string, string[]>();
  for (const r of results ?? []) {
    const list = byRater.get(r.rater_member_id) ?? [];
    list.push(r.target_member_id);
    byRater.set(r.rater_member_id, list);
  }
  return c.json({
    assignments: [...byRater.entries()].map(([raterMemberId, targetMemberIds]) => ({
      raterMemberId,
      targetMemberIds,
    })),
  });
});

/**
 * Replaces the whole map, the same contract as the roster: what the console
 * shows after an edit is exactly what is stored, with no diff to reason about.
 * An empty list clears the map — back to the full matrix.
 */
cohortRoutes.put('/:id/assignments', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const parsed = assignmentsSetSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Please check the assignments.' }, 400);

  const roster = await loadRoster(c.env, id);
  const valid = new Set(roster.map((m) => m.id));

  const statements = [
    c.env.DB.prepare('DELETE FROM cohort_assignments WHERE cohort_id = ?1').bind(id),
  ];
  let count = 0;
  for (const a of parsed.data.assignments) {
    if (!valid.has(a.raterMemberId)) {
      return c.json({ error: 'One of those raters is not on the roster.' }, 400);
    }
    for (const t of new Set(a.targetMemberIds)) {
      if (t === a.raterMemberId) continue; // self-rating is forbidden; silently dropped
      if (!valid.has(t)) return c.json({ error: 'One of those targets is not on the roster.' }, 400);
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO cohort_assignments (id, cohort_id, rater_member_id, target_member_id)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(newId('casg'), id, a.raterMemberId, t),
      );
      count += 1;
    }
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true, pairs: count });
});

/**
 * Reads an assignment map out of a workbook and matches it against the roster
 * by name. Parsed and handed back, never saved — the console shows what was
 * understood, the operator edits, and the PUT above commits.
 *
 * Two shapes are understood, detected from the sheet itself:
 *
 *   matrix — row 1 holds target names from column 2; column 1 holds rater
 *            names from row 2; any non-empty cell assigns that pair.
 *   list   — column 1 holds the rater, columns 2.. hold the names of the
 *            targets that rater is assigned.
 */
cohortRoutes.post('/:id/assignments/upload', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const parsed = rosterUploadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Nothing to read in that file.' }, 400);

  let bytes: Uint8Array;
  try {
    const base64 = parsed.data.fileBase64.replace(/^data:[^,]*,/, '');
    bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return c.json({ error: 'That file could not be read.' }, 400);
  }

  const roster = await loadRoster(c.env, id);
  const byName = new Map(roster.map((m) => [m.name.trim().toLowerCase(), m]));
  const unmatched = new Set<string>();
  const lookup = (raw: string): string | null => {
    const m = byName.get(raw.trim().toLowerCase());
    if (!m) {
      if (raw.trim()) unmatched.add(raw.trim());
      return null;
    }
    return m.id;
  };

  const map = new Map<string, Set<string>>();
  const assign = (rater: string | null, target: string | null): void => {
    if (!rater || !target || rater === target) return;
    const set = map.get(rater) ?? new Set<string>();
    set.add(target);
    map.set(rater, set);
  };

  try {
    // The same sheet rules as a full import, so a client can send the one
    // workbook here too and have only its rating map read.
    const sheets = (await readXlsx(bytes)).filter((w) => !GUIDANCE_SHEET.test(w.name.trim()));
    const ws =
      sheets.find((w) => /assign|who rates|rates whom|rating map|mapping/i.test(w.name.trim())) ?? sheets[0];
    if (!ws) return c.json({ error: 'That workbook has no sheets.' }, 400);

    for (const { rater, target } of readAssignmentSheet(ws, (n) => byName.has(n.trim().toLowerCase()))) {
      assign(lookup(rater), lookup(target));
    }
  } catch {
    return c.json(
      { error: 'That file is not a readable .xlsx workbook. Export it as Excel and try again.' },
      400,
    );
  }

  if (map.size === 0) {
    return c.json(
      {
        error:
          'No assignments found. Use a matrix (targets across the top, raters down the side, any mark in a cell) or a list (rater in the first column, their targets in the cells beside them). Names must match the roster.',
        unmatched: [...unmatched].slice(0, 30),
      },
      400,
    );
  }

  return c.json({
    assignments: [...map.entries()].map(([raterMemberId, targets]) => ({
      raterMemberId,
      targetMemberIds: [...targets],
    })),
    unmatched: [...unmatched].slice(0, 30),
  });
});

// ---------------------------------------------------------------- magic links

/**
 * One person's link, issued if needed and emailed to them.
 *
 * The Access tab could only ever act on everybody at once: somebody who never
 * received their mail meant regenerating the whole cohort, which invalidates
 * the links of everyone who did get theirs and had already started. This is
 * the same act aimed at one row.
 */
cohortRoutes.post('/:id/member-links/:memberId', async (c) => {
  const id = c.req.param('id');
  const memberId = c.req.param('memberId');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const round = await currentRound(c.env, id);
  if (!round) return c.json({ error: 'This cohort has no round yet.' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { send?: boolean; regenerate?: boolean };
  const member = (await loadRoster(c.env, id)).find((m) => m.id === memberId);
  if (!member) return c.json({ error: 'That person is not on this roster.' }, 404);
  if (!member.email.trim()) {
    return c.json({ error: `${member.name} has no email address. Add one on the Roster tab first.` }, 400);
  }

  const link = await personalLinkFor(c.env, cohort, round.no, member, { regenerate: body.regenerate === true });
  if (!link.token) return c.json({ error: 'That link could not be issued.' }, 400);
  const url = `${baseUrl(c.env, c.req.raw)}/t/${link.token}`;

  let sent = false;
  if (body.send !== false) {
    sent = await mailPersonalLink(c.env, {
      branding: brandingForClient(await getBranding(c.env)),
      logoUrl: `${baseUrl(c.env, c.req.raw)}/api/logo`,
      cohort,
      member,
      email: member.email.trim().toLowerCase(),
      url,
    });
    if (!sent) return c.json({ error: `The mail to ${member.name} could not be sent.`, url }, 502);
  }

  return c.json({
    memberId,
    name: member.name,
    email: member.email.trim().toLowerCase(),
    url,
    expiresAt: link.expiresAt,
    regenerated: link.fresh,
    sent,
  });
});

/**
 * Issues each roster member their own personal link — the strongest identity
 * the platform has: an unguessable token already bound to one person, with
 * nothing to type and nobody to impersonate.
 *
 * Idempotent by default: a member who already holds a personal link for this
 * round is left untouched (their link keeps working; its token cannot be
 * re-shown because only its hash is stored). `regenerate` mints everyone a
 * fresh token and kills the old ones — an explicit act, for a list that went
 * to the wrong people. `send` emails each newly minted link to its owner.
 * Tokens are returned once, for the operator copying them out by hand.
 */
/**
 * When a personal link minted now should stop working, or null for never.
 *
 * Zero days is the facilitator choosing "no expiry", which is a real choice —
 * a cohort that runs over a quarter should not have its links die mid-way —
 * and is stored as a zero rather than as a null so that "never" is something
 * somebody picked rather than something nobody set.
 */
function linkExpiryFor(cohort: CohortRow): string | null {
  const days = cohort.link_ttl_days ?? DEFAULT_LINK_TTL_DAYS;
  if (!Number.isFinite(days) || days <= 0) return null;
  const at = new Date(Date.now() + days * 86_400_000);
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * One member's personal link: minted if they have none, re-read if they have.
 *
 * `token_plain` is kept alongside the hash so the Access tab can show the link
 * again tomorrow. It was hash-only, which meant the link existed in exactly one
 * HTTP response and a facilitator who closed the tab had no way to help
 * somebody who never received the mail except to regenerate everybody's — and
 * that invalidates the links of the people who did.
 */
async function personalLinkFor(
  env: Env,
  cohort: CohortRow,
  roundNo: number,
  member: { id: string; name: string; email: string },
  opts: { regenerate?: boolean } = {},
): Promise<{ url: string | null; token: string | null; expiresAt: string | null; fresh: boolean }> {
  const email = member.email.trim().toLowerCase();
  if (!email) return { url: null, token: null, expiresAt: null, fresh: false };

  let cand = await env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
    .bind(email)
    .first<{ id: string }>();
  if (!cand) {
    const parts = member.name.trim().split(/\s+/);
    cand = { id: newId('cand') };
    await env.DB.prepare(
      `INSERT INTO candidates (id, email, first_name, last_name, organisation)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(cand.id, email, parts[0] ?? member.name, parts.slice(1).join(' '), cohort.organisation)
      .run();
  }

  const existing = await env.DB.prepare(
    `SELECT id, token_plain, expires_at FROM links
      WHERE kind = 'personal' AND assessment_id = ?1 AND candidate_id = ?2
        AND cohort_id = ?3 AND round_no = ?4`,
  )
    .bind(cohort.assessment_id, cand.id, cohort.id, roundNo)
    .first<{ id: string; token_plain: string | null; expires_at: string | null }>();

  // A link that is still readable and still in date is handed back as it is:
  // re-minting would break the copy already sitting in somebody's inbox.
  if (existing && !opts.regenerate && existing.token_plain) {
    return { url: null, token: existing.token_plain, expiresAt: existing.expires_at, fresh: false };
  }

  const token = generateToken();
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
  const expiresAt = linkExpiryFor(cohort);
  if (existing) {
    await env.DB.prepare(
      'UPDATE links SET token_hash = ?2, token_plain = ?3, expires_at = ?4, active = 1 WHERE id = ?1',
    )
      .bind(existing.id, hash, token, expiresAt)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO links (id, token_hash, token_plain, kind, assessment_id, candidate_id, cohort_id, round_no, active, expires_at)
       VALUES (?1, ?2, ?3, 'personal', ?4, ?5, ?6, ?7, 1, ?8)`,
    )
      .bind(newId('link'), hash, token, cohort.assessment_id, cand.id, cohort.id, roundNo, expiresAt)
      .run();
  }
  return { url: null, token, expiresAt, fresh: true };
}

/** One magic-link email. Shared, so a single send and a bulk send agree. */
async function mailPersonalLink(
  env: Env,
  args: {
    branding: ReturnType<typeof brandingForClient>;
    logoUrl: string;
    cohort: CohortRow;
    member: { name: string };
    email: string;
    url: string;
  },
): Promise<boolean> {
  const mail = magicLinkEmail({
    branding: args.branding,
    logoUrl: args.logoUrl,
    name: args.member.name,
    cohortName: args.cohort.name,
    organisation: args.cohort.organisation,
    link: args.url,
  });
  const res = await sendMail(env, {
    to: args.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'cohort_magic_link',
  });
  return res.status !== 'failed';
}

/**
 * Who has a link, what it is, and when it runs out.
 *
 * The table used to be filled only by the act of issuing: the tokens existed
 * in one HTTP response and nowhere else, so a reload emptied it and a
 * facilitator who wanted to re-send somebody their link had no link to send.
 * Now it is a question that can be asked at any time.
 */
cohortRoutes.get('/:id/member-links', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const round = await currentRound(c.env, id);
  if (!round) return c.json({ links: [], ttlDays: cohort.link_ttl_days ?? DEFAULT_LINK_TTL_DAYS });

  const roster = await loadRoster(c.env, id);
  const origin = baseUrl(c.env, c.req.raw);

  const { results: rows } = await c.env.DB.prepare(
    `SELECT c.email AS email, l.token_plain AS token, l.expires_at AS expires_at, l.active AS active
       FROM links l
       JOIN candidates c ON c.id = l.candidate_id
      WHERE l.kind = 'personal' AND l.cohort_id = ?1 AND l.round_no = ?2`,
  )
    .bind(id, round.no)
    .all<{ email: string; token: string | null; expires_at: string | null; active: number }>();
  const linkOf = new Map((rows ?? []).map((r) => [r.email.trim().toLowerCase(), r]));

  // The last time each address was sent one of these, so the column says what
  // actually happened rather than only what happened in this browser tab.
  const { results: mails } = await c.env.DB.prepare(
    `SELECT to_email AS email, MAX(COALESCE(sent_at, created_at)) AS at
       FROM mail_outbox
      WHERE kind = 'cohort_magic_link' AND status IN ('sent','logged')
      GROUP BY to_email`,
  ).all<{ email: string; at: string | null }>();
  const mailedAt = new Map((mails ?? []).map((m) => [m.email.trim().toLowerCase(), m.at]));

  return c.json({
    ttlDays: cohort.link_ttl_days ?? DEFAULT_LINK_TTL_DAYS,
    links: roster.map((m) => {
      const email = m.email.trim().toLowerCase();
      const row = email ? linkOf.get(email) : undefined;
      return {
        memberId: m.id,
        name: m.name,
        email,
        url: row?.token ? `${origin}/t/${row.token}` : null,
        expiresAt: row?.expires_at ?? null,
        active: row ? row.active === 1 : false,
        // A link issued before this cohort kept readable copies: it still
        // works, it simply cannot be shown again. Saying so is better than an
        // empty cell that looks like nothing was ever issued.
        opaque: !!row && !row.token,
        emailedAt: email ? mailedAt.get(email) ?? null : null,
        status: !email ? 'no_email' : row ? 'ready' : 'none',
      };
    }),
  });
});

cohortRoutes.post('/:id/member-links', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const round = await currentRound(c.env, id);
  if (!round) return c.json({ error: 'This cohort has no round yet.' }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { send?: boolean; regenerate?: boolean };
  const send = body.send === true;
  const regenerate = body.regenerate === true;

  const roster = await loadRoster(c.env, id);
  const branding = brandingForClient(await getBranding(c.env));
  const logoUrl = `${baseUrl(c.env, c.req.raw)}/api/logo`;
  const origin = baseUrl(c.env, c.req.raw);

  const out: {
    memberId: string;
    name: string;
    email: string;
    url: string | null;
    expiresAt?: string | null;
    status: 'issued' | 'already' | 'no_email';
    sent: boolean;
  }[] = [];

  for (const m of roster) {
    const email = m.email.trim().toLowerCase();
    if (!email) {
      out.push({ memberId: m.id, name: m.name, email: '', url: null, status: 'no_email', sent: false });
      continue;
    }

    const link = await personalLinkFor(c.env, cohort, round.no, m, { regenerate });
    if (!link.token) {
      out.push({ memberId: m.id, name: m.name, email, url: null, status: 'no_email', sent: false });
      continue;
    }
    const url = `${origin}/t/${link.token}`;
    let sent = false;
    if (send) {
      sent = await mailPersonalLink(c.env, { branding, logoUrl, cohort, member: m, email, url });
    }
    out.push({
      memberId: m.id,
      name: m.name,
      email,
      url,
      expiresAt: link.expiresAt,
      status: link.fresh ? 'issued' : 'already',
      sent,
    });
  }

  return c.json({
    links: out,
    issued: out.filter((l) => l.status === 'issued').length,
    already: out.filter((l) => l.status === 'already').length,
    noEmail: out.filter((l) => l.status === 'no_email').length,
    sent: out.filter((l) => l.sent).length,
  });
});

// ----------------------------------------------------------------------- link

/**
 * Issues, or rotates, the link for the cohort's current round.
 *
 * Rotation invalidates every copy of the previous link *for that round*. That
 * is the point of the action — a link that went to the wrong list — so it is
 * never performed implicitly: opening a cohort does not rotate, editing the
 * roster does not rotate, and starting a new round does not rotate the old
 * one's link, it mints a new one beside it.
 */
cohortRoutes.post('/:id/link', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const round = await ensureRound(c.env, cohort);

  // The token about to be replaced. Rotation is irreversible by design — the
  // old hash is gone — so the log is the only place the previous link survives,
  // and putting it back is re-hashing this string.
  const previous = await c.env.DB.prepare(
    `SELECT id, token_plain, active FROM links
      WHERE cohort_id = ?1 AND kind = 'generic' AND round_no = ?2`,
  )
    .bind(id, round.no)
    .first<{ id: string; token_plain: string | null; active: number }>();

  const { token } = await issueRoundLink(c.env, cohort, round.no);

  recordBefore(c, {
    action: previous ? 'cohort.link.reissue' : 'cohort.link.issue',
    entity: 'cohort',
    entityId: id,
    summary: previous
      ? `Re-issued the link for ${roundName(round)} of "${cohort.name}". The previous link stopped working.`
      : `Issued the link for ${roundName(round)} of "${cohort.name}".`,
    before: previous ? { linkId: previous.id, token: previous.token_plain, active: previous.active === 1 } : null,
    after: { roundNo: round.no, token },
  });
  return c.json({ token, url: `${baseUrl(c.env, c.req.raw)}/t/${token}`, roundNo: round.no });
});

/**
 * Starts the next round: the same group, asked again.
 *
 * Nothing from the previous round is touched. Its link keeps resolving and says
 * which round it was for, its responses stay exactly as they were given, and
 * its reports keep their tokens — a leader who was sent their September profile
 * can still open it in December. What the new round gets is its own link and an
 * empty set of responses, so everyone on the roster can rate again.
 *
 * The roster is not copied because it never moved: positions belong to the
 * cohort, which is what makes the two rounds comparable person by person.
 */
cohortRoutes.post('/:id/rounds', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';

  const roster = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ?1 AND active = 1',
  )
    .bind(id)
    .first<{ n: number }>();
  if ((roster?.n ?? 0) < 2) {
    return c.json(
      { error: 'Add at least two people to the roster before starting a round — there is nobody to rate otherwise.' },
      400,
    );
  }

  const previous = await currentRound(c.env, id);
  const no = (previous?.no ?? 0) + 1;

  // The previous round stops taking responses the moment the next one opens.
  // Two open waves would mean one person answering twice into a set of numbers
  // that cannot tell the two apart.
  if (previous && !previous.closed_at) {
    await c.env.DB.prepare(`UPDATE cohort_rounds SET closed_at = datetime('now') WHERE id = ?1`)
      .bind(previous.id)
      .run();
  }

  await c.env.DB.prepare(
    'INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(newId('crd'), id, no, label)
    .run();

  // A new round is an open exercise by definition; a cohort closed after the
  // last one is reopened by starting another.
  await c.env.DB.prepare(
    `UPDATE cohorts SET status = 'open', closed_at = NULL WHERE id = ?1`,
  )
    .bind(id)
    .run();

  const { token } = await issueRoundLink(c.env, cohort, no);
  const round = await roundByNo(c.env, id, no);

  recordBefore(c, {
    action: 'cohort.round.start',
    entity: 'cohort',
    entityId: id,
    summary: `Started ${roundName(round ?? { no, label })} of "${cohort.name}". ${
      previous ? `${roundName(previous)} stopped taking responses; its answers and reports are unchanged.` : ''
    }`,
    before: previous ? { roundNo: previous.no, label: previous.label, closedAt: previous.closed_at } : null,
    after: { roundNo: no, label, token },
  });

  return c.json({
    roundNo: no,
    roundName: roundName(round ?? { no, label }),
    token,
    url: `${baseUrl(c.env, c.req.raw)}/t/${token}`,
  });
});

cohortRoutes.get('/:id/rounds', async (c) => {
  const cohort = await loadCohort(c.env, c.req.param('id'));
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  return c.json({ rounds: await roundSummaries(c.env, cohort.id) });
});

/**
 * A cohort created before rounds existed, or one whose round was deleted, still
 * has to answer "which wave is this". Round 1 is created on demand rather than
 * left to fail at the next insert.
 */
async function ensureRound(env: Env, cohort: CohortRow): Promise<RoundRow> {
  const existing = await currentRound(env, cohort.id);
  if (existing) return existing;
  await env.DB.prepare('INSERT INTO cohort_rounds (id, cohort_id, no, label) VALUES (?1, ?2, 1, ?3)')
    .bind(newId('crd'), cohort.id, '')
    .run();
  return (await currentRound(env, cohort.id))!;
}

/** Mints, or rotates, the generic link belonging to one round. */
async function issueRoundLink(
  env: Env,
  cohort: CohortRow,
  roundNo: number,
): Promise<{ token: string }> {
  const token = generateToken();
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);

  const existing = await env.DB.prepare(
    "SELECT id FROM links WHERE cohort_id = ?1 AND kind = 'generic' AND round_no = ?2",
  )
    .bind(cohort.id, roundNo)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      'UPDATE links SET token_hash = ?2, token_plain = ?3, active = 1 WHERE id = ?1',
    )
      .bind(existing.id, hash, token)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO links (id, token_hash, token_plain, kind, assessment_id, candidate_id, cohort_id, round_no, active)
       VALUES (?1, ?2, ?3, 'generic', ?4, NULL, ?5, ?6, 1)`,
    )
      .bind(newId('link'), hash, token, cohort.assessment_id, cohort.id, roundNo)
      .run();
  }
  return { token };
}

/**
 * Every link this group has ever been given.
 *
 * Two sources, because a link can outlive its own row. The `links` table holds
 * what is live now — one per round, plus the personal continuation links people
 * were handed when they claimed a name. The activity log holds what was
 * replaced: rotating a link overwrites its hash, so the only remaining record
 * of the token people were sent last week is the snapshot taken when it was
 * rotated. Both belong in one list, because "the link I sent them" is a
 * question about the past as often as about the present.
 */
cohortRoutes.get('/:id/links', async (c) => {
  const id = c.req.param('id');
  const cohort = await loadCohort(c.env, id);
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);

  const live = await c.env.DB.prepare(
    `SELECT l.id, l.kind, l.round_no, l.token_plain, l.active, l.created_at, l.last_seen_at,
            rd.label AS round_label, rd.closed_at AS round_closed_at,
            ca.email AS candidate_email,
            (SELECT COUNT(*) FROM responses r
              WHERE r.cohort_id = ?1 AND r.round_no = l.round_no
                AND r.status = 'completed') AS respondents
       FROM links l
       LEFT JOIN cohort_rounds rd ON rd.cohort_id = ?1 AND rd.no = l.round_no
       LEFT JOIN candidates ca ON ca.id = l.candidate_id
      WHERE l.cohort_id = ?1
      ORDER BY l.round_no DESC, l.kind, l.created_at DESC`,
  )
    .bind(id)
    .all<{
      id: string;
      kind: 'generic' | 'personal';
      round_no: number;
      token_plain: string | null;
      active: number;
      created_at: string;
      last_seen_at: string | null;
      round_label: string | null;
      round_closed_at: string | null;
      candidate_email: string | null;
      respondents: number;
    }>();

  const history = await c.env.DB.prepare(
    `SELECT id, at, action, summary, before_json
       FROM admin_audit
      WHERE entity = 'cohort' AND entity_id = ?1
        AND action IN ('cohort.link.reissue', 'cohort.link.issue', 'links.restore')
        AND before_json IS NOT NULL
      ORDER BY at DESC
      LIMIT 100`,
  )
    .bind(id)
    .all<{ id: string; at: string; action: string; summary: string; before_json: string }>();

  interface PreviousLink {
    token?: string | null;
    linkId?: string;
  }

  const superseded = (history.results ?? [])
    .map((row) => {
      let before: PreviousLink | null = null;
      try {
        before = JSON.parse(row.before_json) as PreviousLink;
      } catch {
        before = null;
      }
      if (!before?.token) return null;
      return {
        kind: 'superseded' as const,
        auditId: row.id,
        linkId: before.linkId ?? null,
        token: before.token,
        replacedAt: row.at,
        summary: row.summary,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return c.json({
    cohortId: id,
    cohortName: cohort.name,
    live: (live.results ?? []).map((l) => ({
      linkId: l.id,
      kind: l.kind,
      roundNo: l.round_no,
      roundName: roundName({ no: l.round_no, label: l.round_label ?? '' }),
      roundClosed: l.round_closed_at !== null,
      // A personal link is stored as a hash alone: it is one person's
      // credential and is re-issued rather than recovered.
      token: l.kind === 'generic' ? l.token_plain : null,
      candidateEmail: l.candidate_email,
      active: l.active === 1,
      createdAt: l.created_at,
      lastSeenAt: l.last_seen_at,
      respondents: l.respondents,
    })),
    superseded,
  });
});

// ---------------------------------------------------------------------- trend

/**
 * The group across its rounds: what moved, and whether enough people answered
 * for the movement to mean anything.
 */
cohortRoutes.get('/:id/trend', async (c) => {
  const cohort = await loadCohort(c.env, c.req.param('id'));
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  try {
    return c.json(await buildCohortTrend(c.env, cohort));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not read this cohort.' }, 400);
  }
});

// -------------------------------------------------------------------- reports

/**
 * Which wave a report action is about: `?round=2`, or the current one.
 *
 * A facilitator regenerating September's reports in October is doing something
 * legitimate — a name was corrected, a member was reinstated — so the round is
 * addressable rather than always implied.
 */
async function roundFromQuery(
  env: Env,
  cohort: CohortRow,
  raw: string | undefined,
): Promise<RoundRow | null> {
  if (raw) {
    const no = Number(raw);
    if (!Number.isInteger(no) || no < 1) return null;
    return roundByNo(env, cohort.id, no);
  }
  return ensureRound(env, cohort);
}

/** A dry run: score the cohort and report what would be produced. */
cohortRoutes.get('/:id/preview', async (c) => {
  const cohort = await loadCohort(c.env, c.req.param('id'));
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const round = await roundFromQuery(c.env, cohort, c.req.query('round'));
  if (!round) return c.json({ error: 'That round does not exist.' }, 404);

  try {
    const group = await scoreCohort(c.env, cohort, round.no);
    return c.json({
      roundNo: round.no,
      roundName: roundName(round),
      respondents: group.respondents,
      rosterSize: group.rosterSize,
      ratingsGiven: group.ratingsGiven,
      acquaintance: group.acquaintance,
      reportable: group.members.filter((m) => !m.suppressed).length,
      suppressed: group.underCovered,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not score this cohort.' }, 400);
  }
});

cohortRoutes.post('/:id/reports', async (c) => {
  const cohort = await loadCohort(c.env, c.req.param('id'));
  if (!cohort) return c.json({ error: 'Cohort not found' }, 404);
  const round = await roundFromQuery(c.env, cohort, c.req.query('round'));
  if (!round) return c.json({ error: 'That round does not exist.' }, 404);

  try {
    const result = await generateCohortReports(c.env, cohort, round);
    return c.json({
      roundNo: round.no,
      roundName: roundName(round),
      groupToken: result.group.token,
      groupUrl: `${baseUrl(c.env, c.req.raw)}/c/${result.group.token}`,
      members: result.members.length,
      suppressed: result.suppressed,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not generate reports.' }, 400);
  }
});

cohortRoutes.get('/:id/reports', async (c) => {
  // Without a round, every wave's reports — the console groups them. With one,
  // just that wave.
  const roundFilter = c.req.query('round');
  const { results } = await c.env.DB.prepare(
    `SELECT cr.id, cr.scope, cr.member_id, cr.suppressed, cr.created_at, cr.sent_at,
            cr.token_plain, cr.round_no, rd.label AS round_label,
            m.name AS member_name, m.email AS member_email
       FROM cohort_reports cr
       LEFT JOIN cohort_members m ON m.id = cr.member_id
       LEFT JOIN cohort_rounds rd ON rd.cohort_id = cr.cohort_id AND rd.no = cr.round_no
      WHERE cr.cohort_id = ?1 AND (?2 IS NULL OR cr.round_no = ?2)
      ORDER BY cr.round_no DESC, cr.scope DESC, m.no`,
  )
    .bind(c.req.param('id'), roundFilter ? Number(roundFilter) : null)
    .all<{
      id: string;
      scope: 'group' | 'member';
      member_id: string | null;
      suppressed: number;
      created_at: string;
      sent_at: string | null;
      token_plain: string | null;
      round_no: number;
      round_label: string | null;
      member_name: string | null;
      member_email: string | null;
    }>();

  return c.json({
    reports: (results ?? []).map((r) => ({
      id: r.id,
      scope: r.scope,
      memberId: r.member_id,
      memberName: r.member_name,
      memberEmail: r.member_email,
      suppressed: r.suppressed === 1,
      roundNo: r.round_no,
      roundName: roundName({ no: r.round_no, label: r.round_label ?? '' }),
      createdAt: r.created_at,
      sentAt: r.sent_at,
      // Only the group report retains a readable token; a member's is stored
      // as a hash alone and can only be re-issued, never recovered.
      url: r.token_plain ? `${baseUrl(c.env, c.req.raw)}/c/${r.token_plain}` : null,
    })),
  });
});

async function reportRow(c: { env: Env }, reportId: string): Promise<CohortReportRow | null> {
  return c.env.DB.prepare(`${COHORT_REPORT_SELECT} WHERE cr.id = ?1`)
    .bind(reportId)
    .first<CohortReportRow>();
}

cohortRoutes.get('/:id/reports/:reportId/pdf', async (c) => {
  const row = await reportRow(c, c.req.param('reportId'));
  if (!row || row.cohort_id !== c.req.param('id')) return c.json({ error: 'Report not found' }, 404);

  const bytes = await renderStoredCohortPdf(row, await getBranding(c.env));
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${cohortPdfName(row)}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
});

/**
 * Emails one member their report, re-issuing the link in the process.
 *
 * A member report token is stored only as a keyed hash, so there is nothing to
 * resend — a new token is minted, the old one stops working, and the fresh one
 * goes out in the mail. That is the honest behaviour for a credential that
 * cannot be read back, and it means a link forwarded by mistake can be revoked
 * by pressing send again.
 */
cohortRoutes.post('/:id/reports/:reportId/send', async (c) => {
  const row = await reportRow(c, c.req.param('reportId'));
  if (!row || row.cohort_id !== c.req.param('id')) return c.json({ error: 'Report not found' }, 404);
  if (row.scope !== 'member') {
    return c.json({ error: 'The group report is for the facilitators and is not mailed to participants.' }, 400);
  }
  if (row.suppressed === 1) {
    return c.json(
      { error: 'This member was rated by too few colleagues for a profile, so there is nothing to send.' },
      400,
    );
  }

  const token = generateToken();
  await c.env.DB.prepare('UPDATE cohort_reports SET token_hash = ?2 WHERE id = ?1')
    .bind(row.report_id, await hashToken(token, c.env.LINK_TOKEN_SECRET))
    .run();

  await dispatch(
    c.env,
    { type: 'send_cohort_report', cohortReportId: row.report_id, reportToken: token },
    c.executionCtx,
  );

  return c.json({ queued: true });
});

/**
 * Re-issues a member's link and returns it once, for a facilitator handing
 * reports over in person rather than by email. The previous link stops working.
 */
cohortRoutes.post('/:id/reports/:reportId/reissue', async (c) => {
  const row = await reportRow(c, c.req.param('reportId'));
  if (!row || row.cohort_id !== c.req.param('id')) return c.json({ error: 'Report not found' }, 404);

  const token = generateToken();
  await c.env.DB.prepare('UPDATE cohort_reports SET token_hash = ?2 WHERE id = ?1')
    .bind(row.report_id, await hashToken(token, c.env.LINK_TOKEN_SECRET))
    .run();

  return c.json({ url: `${baseUrl(c.env, c.req.raw)}/c/${token}` });
});
