/**
 * Two people, measure by measure.
 *
 * The rest of the page ranks a roster; this answers the question a facilitator
 * is actually asked in the room — "how do these two compare?" — without making
 * anybody read two dossiers and hold the difference in their head.
 *
 * Three things do that work, and the first two were missing while this was a
 * grid of bare numbers:
 *
 *  - A BAR per value, scaled to the largest on its own row. Two integers side
 *    by side make a reader do arithmetic; two bars make the answer the shape
 *    of the row. The number stays, because the exact figure is what gets
 *    written down afterwards.
 *  - The GAP, said once, in the measure's own units. It is the number the
 *    question was asked to produce and it used to be the one thing the reader
 *    had to work out for themselves.
 *  - A leader marked only where leading means something. Betweenness, trust
 *    given and coverage describe the group's structure and who answered, not
 *    merit, and a rosette on those would invent a judgement the instrument
 *    does not make.
 */

import type { CSSProperties } from 'react';
import { metricLeader, type PairMetric } from './model.js';
import { Avatar } from './InsightsChrome.js';

export interface Side {
  no: number;
  name: string;
  func: string;
  color: string;
}

/** The largest value on a row, for scaling its bars. Null where nothing is rated. */
function rowMax(m: PairMetric): number | null {
  const seen = m.values.filter((v): v is number => v !== null).map(Math.abs);
  const max = Math.max(0, ...seen);
  return seen.length === 0 || max === 0 ? null : max;
}

export function HeadToHead({
  sides,
  metrics,
  verdict,
  onPick,
}: {
  /** Two for a head-to-head, more for a shortlist. Same panel either way. */
  sides: readonly Side[];
  metrics: readonly PairMetric[];
  /**
   * Optional: on the Insights tab the stage headline already carries this
   * sentence, and printing it twice makes the reader check whether the two
   * copies say the same thing.
   */
  verdict?: string;
  onPick?: (no: number) => void;
}) {
  // The gap column only exists for a pair: with three people "the difference"
  // is not one number, and a column that means something different depending
  // on how many are ticked is worse than no column.
  const pair = sides.length === 2;
  // The value columns are sized from the count, so three people do not squeeze
  // the labels the way two fixed columns would.
  // Heads and rows are one grid, declared once: two grids with "matching"
  // templates drift the moment a head's content is wider than its track, and
  // the columns stop lining up with the numbers under them.
  const cols = `var(--h2h-label) repeat(${sides.length}, var(--h2h-col))${pair ? ' var(--h2h-gap)' : ''}`;
  return (
    <div
      className="h2h"
      style={
        {
          // The measure column is capped rather than elastic: at 1fr it ate the
          // width and left the people as two narrow columns pinned to the right
          // edge, far from the label they belong to.
          '--h2h-label': sides.length > 3 ? '230px' : 'minmax(200px, 300px)',
          '--h2h-col': sides.length > 3 ? '132px' : 'minmax(150px, 1fr)',
          '--h2h-gap': '96px',
        } as CSSProperties
      }
    >
      <div className={`h2h-scroll${sides.length > 3 ? ' is-wide' : ''}`}>
        <div className="h2h-heads" style={{ gridTemplateColumns: cols }}>
          <span className="h2h-heads-label">Measure</span>
          {sides.map((s) => (
            <button
              key={s.no}
              type="button"
              className="h2h-head"
              onClick={() => onPick?.(s.no)}
              title={`Focus ${s.name} on every other question`}
            >
              <Avatar name={s.name} color={s.color} />
              <span className="h2h-head-text">
                <b>{s.name}</b>
                <span>{s.func || '—'}</span>
              </span>
            </button>
          ))}
          {pair ? <span className="h2h-heads-gap">Gap</span> : null}
        </div>

        {verdict ? <p className="h2h-verdict">{verdict}</p> : null}

        <dl className="h2h-rows">
          {metrics.map((m) => {
            const lead = metricLeader(m);
            const max = rowMax(m);
            const a = m.values[0];
            const b = m.values[1];
            const gap = pair && a !== null && a !== undefined && b !== null && b !== undefined
              ? Math.abs(a - b)
              : null;
            return (
              <div className="h2h-row" key={m.key} style={{ gridTemplateColumns: cols }}>
                <dt>
                  {m.label}
                  <span>{m.note}</span>
                </dt>
                {m.texts.map((text, i) => {
                  const value = m.values[i];
                  const share = max !== null && value !== null && value !== undefined
                    ? Math.min(1, Math.abs(value) / max)
                    : 0;
                  return (
                    <dd
                      key={i}
                      className={`h2h-val${lead === i ? ' is-lead' : ''}${
                        lead !== null && lead !== i ? ' is-trail' : ''
                      }`}
                    >
                      <span className="h2h-bar" aria-hidden="true">
                        <i
                          style={{
                            width: `${Math.round(share * 100)}%`,
                            background: sides[i]?.color ?? 'var(--ink-3)',
                          }}
                        />
                      </span>
                      <b>
                        {text}
                        {lead === i ? <i aria-label="leads this measure">▲</i> : null}
                      </b>
                    </dd>
                  );
                })}
                {pair ? (
                  <dd
                    className={`h2h-gap${lead === null ? ' is-level' : ''}`}
                    title={
                      lead === null
                        ? 'Level, or not a measure anybody leads'
                        : `${sides[lead]?.name} by ${m.fmt(gap)}`
                    }
                  >
                    {gap === null || lead === null ? (
                      <span className="h2h-gap-level">level</span>
                    ) : (
                      <>
                        <span className="h2h-gap-arrow" aria-hidden="true">
                          {lead === 0 ? '◀' : '▶'}
                        </span>
                        {m.fmt(gap)}
                      </>
                    )}
                  </dd>
                ) : null}
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
