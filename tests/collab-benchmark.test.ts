import { describe, expect, it } from 'vitest';
import { COLLAB_ITEM_COUNT } from '../src/shared/collab.js';
import { MIN_ORGS, collabBenchmark } from '../src/worker/lib/collab-benchmark.js';
import type { Env } from '../src/worker/env.js';

/** A run's worth of identical sheets, so each organisation has a known mean. */
function sheet(value: number): Record<number, number> {
  const answers: Record<number, number> = {};
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) answers[no] = value;
  return answers;
}

/**
 * A stub holding several organisations, each answering at one level.
 *
 * Only runs that opted in are ever handed back by the query the benchmark
 * makes, so the stub models that: `optedIn` is the whole world it can see.
 */
function stubDb(optedIn: { id: string; value: number }[]) {
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...binds: unknown[]) => ({
            all: async () => {
              if (/FROM cohorts co/.test(sql)) {
                return { results: optedIn.map((o) => ({ id: o.id, round_no: 1 })) };
              }
              const org = optedIn.find((o) => o.id === binds[0]);
              if (!org) return { results: [] };
              if (/SELECT id, anonymous/.test(sql)) {
                return { results: [{ id: `${org.id}-r1`, anonymous: 1 }] };
              }
              if (/FROM answers/.test(sql)) {
                return {
                  results: Object.entries(sheet(org.value)).map(([no, value]) => ({
                    response_id: `${org.id}-r1`,
                    no: Number(no),
                    value,
                  })),
                };
              }
              return { results: [] };
            },
            first: async () => null,
          }),
        };
      },
    },
  } as unknown as Env;
  return env;
}

describe('comparing one organisation with the others', () => {
  it('shows nothing below the floor, and says why', async () => {
    const env = stubDb([
      { id: 'a', value: 3 },
      { id: 'b', value: 4 },
    ]);
    const bench = await collabBenchmark(env, 'a');
    // With two organisations, "the benchmark" is one other company and the
    // reader can work out which.
    expect(bench.sections).toBeNull();
    expect(bench.withheld).toContain(`at least ${MIN_ORGS}`);
    expect(bench.orgs).toBe(2);
  });

  it('reports a median and a range once enough have opted in', async () => {
    const env = stubDb([
      { id: 'a', value: 2 },
      { id: 'b', value: 3 },
      { id: 'c', value: 3 },
      { id: 'd', value: 4 },
    ]);
    const bench = await collabBenchmark(env, 'a');
    expect(bench.withheld).toBeNull();
    expect(bench.orgs).toBe(4);
    expect(bench.sections).toHaveLength(6);
    const first = bench.sections![0]!;
    expect(first.low).toBeLessThanOrEqual(first.median);
    expect(first.median).toBeLessThanOrEqual(first.high);
  });

  it('never carries anything that could name an organisation', async () => {
    const env = stubDb([
      { id: 'acme-pharma', value: 2 },
      { id: 'b', value: 3 },
      { id: 'c', value: 3 },
      { id: 'd', value: 4 },
    ]);
    const bench = await collabBenchmark(env, 'acme-pharma');
    // Which organisation sits where is precisely what this must not say, so
    // there is no field that could carry it.
    const json = JSON.stringify(bench);
    expect(json).not.toContain('acme-pharma');
    expect(json).not.toContain('cohortId');
  });

  it('places the subject against the others, and works without one', async () => {
    const orgs = [
      { id: 'a', value: 2 },
      { id: 'b', value: 3 },
      { id: 'c', value: 3 },
      { id: 'd', value: 4 },
    ];
    const mine = await collabBenchmark(stubDb(orgs), 'a');
    expect(mine.you).not.toBeNull();
    expect(mine.sections![0]!.you).not.toBeNull();

    const anonymousView = await collabBenchmark(stubDb(orgs), null);
    expect(anonymousView.you).toBeNull();
    expect(anonymousView.sections![0]!.you).toBeNull();
    expect(anonymousView.median).not.toBeNull();
  });

  it('counts an organisation nobody answered as not there', async () => {
    const env = stubDb([]);
    const bench = await collabBenchmark(env, 'a');
    expect(bench.orgs).toBe(0);
    expect(bench.sections).toBeNull();
  });
});
