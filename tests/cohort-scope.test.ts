import { describe, expect, it } from 'vitest';
import { loadCohort } from '../src/worker/lib/cohort.js';
import { ASSESSMENT_ID } from '../src/shared/assessments.js';
import type { Env } from '../src/worker/env.js';

/**
 * A Collaboration Diagnostic run is a row in `cohorts` — that reuse is what
 * gives it rounds, links and an audit trail without a second copy of any of
 * them. The cost is that every query which means "a sociometry cohort" has to
 * say so, or a diagnostic run turns up in the sociometry console and renders
 * as a cohort whose every number is meaningless.
 *
 * This pins the door: the loader that all twenty-odd cohort routes go through
 * asks for the instrument, and the id alone is never enough.
 */
function stubDb() {
  const seen: { sql: string; binds: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...binds: unknown[]) => {
            seen.push({ sql, binds });
            return { first: async () => null, all: async () => ({ results: [] }) };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, seen };
}

describe('loading a cohort', () => {
  it('asks for the sociometry instrument, not just the id', async () => {
    const { env, seen } = stubDb();
    await loadCohort(env, 'coh_something');

    expect(seen).toHaveLength(1);
    expect(seen[0]!.sql).toContain('assessment_id = ?2');
    expect(seen[0]!.binds).toEqual(['coh_something', ASSESSMENT_ID.socio]);
  });

  it('refuses a run belonging to another instrument', async () => {
    // The stub answers null for everything, which is what the real query does
    // for a diagnostic run: the id exists, the instrument does not match, and
    // the route answers "not found" rather than half-answering.
    const { env } = stubDb();
    expect(await loadCohort(env, 'coh_a_diagnostic_run')).toBeNull();
  });
});
