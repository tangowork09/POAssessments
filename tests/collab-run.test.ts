import { describe, expect, it } from 'vitest';
import { COLLAB_ITEM_COUNT } from '../src/shared/collab.js';
import {
  CollabRunError,
  anonymousCandidateEmail,
  isCompleteRun,
  loadRunResponses,
  runTurnout,
  scoreRun,
} from '../src/worker/lib/collab-run.js';
import type { Env } from '../src/worker/env.js';

/**
 * A stub D1 that answers by matching the shape of the SQL it is given.
 *
 * The queries here are the point of the module — which table a fact is read
 * from decides whether anonymity survives — so the tests assert on the SQL as
 * well as on the result. A version of `loadRunResponses` that fetched
 * departments by joining `candidates` would pass a mock that only checked
 * numbers.
 */
function stubDb(tables: {
  responses?: { id: string; anonymous: number }[];
  answers?: { response_id: string; no: number; value: number }[];
  facets?: { response_id: string; key: string; value: string }[];
  cohortFacets?: { key: string; label: string; options: string }[];
  turnout?: { personal_links: number; roster: number; started: number; completed: number };
}) {
  const seen: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        seen.push(sql);
        const pick = () => {
          if (/FROM responses\b/.test(sql) && /SELECT id, anonymous/.test(sql)) return tables.responses ?? [];
          if (/FROM answers\b/.test(sql)) return tables.answers ?? [];
          if (/FROM response_facets\b/.test(sql)) return tables.facets ?? [];
          if (/FROM cohort_facets\b/.test(sql)) return tables.cohortFacets ?? [];
          return [];
        };
        return {
          bind: () => ({
            all: async () => ({ results: pick() }),
            first: async () => (/personal_links/.test(sql) ? (tables.turnout ?? null) : (pick()[0] ?? null)),
          }),
        };
      },
    },
  } as unknown as Env;
  return { env, seen };
}

/** All 24 answers at one value, as a respondent's raw sheet. */
function sheet(responseId: string, value: number) {
  return Array.from({ length: COLLAB_ITEM_COUNT }, (_, i) => ({
    response_id: responseId,
    no: i + 1,
    value,
  }));
}

describe('loading a wave', () => {
  it('reads answers and segments without touching candidates', async () => {
    const { env, seen } = stubDb({
      responses: [{ id: 'resp1', anonymous: 1 }],
      answers: sheet('resp1', 3),
      facets: [{ response_id: 'resp1', key: 'department', value: 'Operations' }],
    });

    const [response] = await loadRunResponses(env, 'co1', 1);
    expect(response).toBeDefined();
    expect(response!.anonymous).toBe(true);
    expect(Object.keys(response!.answers)).toHaveLength(24);
    expect(response!.facets).toEqual({ department: 'Operations' });

    // The promise of anonymity is a storage property. Nothing on this path may
    // read the person: no candidates table, no roster, no email column.
    const sql = seen.join(' ').toLowerCase();
    expect(sql).not.toContain('candidates');
    expect(sql).not.toContain('cohort_members');
    expect(sql).not.toContain('email');
  });

  it('gives a respondent who answered nothing an empty sheet rather than dropping them', async () => {
    const { env } = stubDb({
      responses: [{ id: 'resp1', anonymous: 0 }, { id: 'resp2', anonymous: 0 }],
      answers: sheet('resp1', 4),
    });
    const responses = await loadRunResponses(env, 'co1', 1);
    expect(responses).toHaveLength(2);
    expect(responses[1]!.answers).toEqual({});
  });

  it('asks for nothing else when a wave has no responses', async () => {
    const { env, seen } = stubDb({ responses: [] });
    expect(await loadRunResponses(env, 'co1', 1)).toEqual([]);
    expect(seen).toHaveLength(1);
  });
});

describe('turnout', () => {
  it('counts personal links as the denominator when they were issued', async () => {
    const { env } = stubDb({ turnout: { personal_links: 50, roster: 50, started: 48, completed: 47 } });
    expect(await runTurnout(env, 'co1', 1)).toEqual({ invited: 50, started: 48, completed: 47 });
  });

  it('falls back to the roster when the run is chased by list', async () => {
    const { env } = stubDb({ turnout: { personal_links: 0, roster: 32, started: 20, completed: 18 } });
    expect((await runTurnout(env, 'co1', 1)).invited).toBe(32);
  });

  it('reports no denominator for a run on one shared link, rather than inventing one', async () => {
    const { env } = stubDb({ turnout: { personal_links: 0, roster: 0, started: 12, completed: 11 } });
    const turnout = await runTurnout(env, 'co1', 1);
    expect(turnout.invited).toBe(0);
    expect(turnout.completed).toBe(11);
  });
});

describe('scoring a wave', () => {
  const sixResponses = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, anonymous: 1 }));
  const sixSheets = sixResponses.flatMap((r) => sheet(r.id, 3));

  it('scores the group and cuts it by each declared facet', async () => {
    const { env } = stubDb({
      responses: sixResponses,
      answers: sixSheets,
      // Five in Operations, one in Quality: one segment clears a floor of five,
      // the other must not.
      facets: sixResponses.map((r, i) => ({
        response_id: r.id,
        key: 'department',
        value: i < 5 ? 'Operations' : 'Quality & QA',
      })),
      cohortFacets: [
        { key: 'department', label: 'Department', options: '["Operations","Quality & QA","R&D"]' },
      ],
      turnout: { personal_links: 6, roster: 6, started: 6, completed: 6 },
    });

    const { group, cuts } = await scoreRun(env, { id: 'co1', min_segment: 5 }, 1);
    expect(group.n).toBe(6);
    expect(group.perItem).toBe(3);

    expect(cuts).toHaveLength(1);
    const segments = cuts[0]!.segments;
    // Every declared option appears, including the one nobody chose.
    expect(segments.map((s) => s.name)).toEqual(['Operations', 'Quality & QA', 'R&D']);

    const [operations, quality, rnd] = segments;
    expect(operations!.suppressed).toBe(false);
    expect(operations!.n).toBe(5);
    expect(quality!.suppressed).toBe(true);
    expect(quality!.sections).toBeNull();
    expect(quality!.n).toBe(1);
    expect(rnd!.n).toBe(0); // reported as empty, not omitted
    expect(rnd!.suppressed).toBe(true);
  });

  it('keeps a value that is no longer on the option list', async () => {
    const { env } = stubDb({
      responses: sixResponses,
      answers: sixSheets,
      facets: sixResponses.map((r) => ({ response_id: r.id, key: 'department', value: 'Legacy Ops' })),
      cohortFacets: [{ key: 'department', label: 'Department', options: '["Operations"]' }],
      turnout: { personal_links: 6, roster: 6, started: 6, completed: 6 },
    });
    const { cuts } = await scoreRun(env, { id: 'co1', min_segment: 5 }, 1);
    const legacy = cuts[0]!.segments.find((s) => s.name === 'Legacy Ops');
    expect(legacy).toBeDefined();
    expect(legacy!.n).toBe(6);
    expect(legacy!.suppressed).toBe(false);
  });

  it('refuses to score a wave nobody has completed', async () => {
    const { env } = stubDb({ responses: [] });
    await expect(scoreRun(env, { id: 'co1', min_segment: 5 }, 1)).rejects.toThrow(CollabRunError);
  });

  it('rejects a segment list that is not a list', async () => {
    const { env } = stubDb({
      responses: sixResponses,
      answers: sixSheets,
      cohortFacets: [{ key: 'department', label: 'Department', options: '"Operations"' }],
    });
    await expect(scoreRun(env, { id: 'co1', min_segment: 5 }, 1)).rejects.toThrow(/not a list/);
  });
});

describe('submission helpers', () => {
  it('knows a complete sheet from a gap at either end', () => {
    const full: Record<number, number> = {};
    for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) full[no] = 3;
    expect(isCompleteRun(full)).toBe(true);

    const missingFirst = { ...full };
    delete missingFirst[1];
    expect(isCompleteRun(missingFirst)).toBe(false);

    const missingLast = { ...full };
    delete missingLast[COLLAB_ITEM_COUNT];
    expect(isCompleteRun(missingLast)).toBe(false);
  });

  it('addresses anonymous responses at a domain that can never receive mail', () => {
    const email = anonymousCandidateEmail('coh_abc', 2);
    expect(email).toBe('anonymous+coh_abc-r2@respondent.invalid');
    expect(email.endsWith('.invalid')).toBe(true);
    // One placeholder per wave, so two waves never share a row.
    expect(anonymousCandidateEmail('coh_abc', 3)).not.toBe(email);
  });
});
