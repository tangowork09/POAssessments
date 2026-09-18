/**
 * Two people, measure by measure.
 *
 * The rest of the page ranks a roster; this answers the question a facilitator
 * is actually asked in the room — "how do these two compare?" — without making
 * anybody read two dossiers and hold the difference in their head.
 *
 * It marks a leader per row only where leading means something. Betweenness,
 * trust given and coverage describe the group's structure and who answered,
 * not merit, and a rosette on those would invent a judgement the instrument
 * does not make.
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
  // The value columns are sized from the count, so three people do not squeeze
  // the labels the way two fixed columns would.
  // Heads and rows are one grid, declared once: two grids with "matching"
  // templates drift the moment a head's content is wider than its track, and
  // the columns stop lining up with the numbers under them.
  const cols = `var(--h2h-label) repeat(${sides.length}, var(--h2h-col))`;
  return (
    <div
      className="h2h"
      style={
        {
          // The measure column is capped rather than elastic: at 1fr it ate the
          // width and left the people as two narrow columns pinned to the right
          // edge, far from the label they belong to.
          '--h2h-label': sides.length > 3 ? '230px' : 'minmax(240px, 340px)',
          '--h2h-col': sides.length > 3 ? '132px' : 'minmax(120px, 1fr)',
        } as CSSProperties
      }
    >
      <div className={`h2h-scroll${sides.length > 3 ? ' is-wide' : ''}`}>
        <div className="h2h-heads" style={{ gridTemplateColumns: cols }}>
          <span aria-hidden="true" />
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
        </div>

        {verdict ? <p className="h2h-verdict">{verdict}</p> : null}

        <dl className="h2h-rows">
          {metrics.map((m) => {
            const lead = metricLeader(m);
            return (
              <div className="h2h-row" key={m.key} style={{ gridTemplateColumns: cols }}>
                <dt>
                  {m.label}
                  <span>{m.note}</span>
                </dt>
                {m.texts.map((text, i) => (
                  <dd
                    key={i}
                    className={`h2h-val${lead === i ? ' is-lead' : ''}${
                      lead !== null && lead !== i ? ' is-trail' : ''
                    }`}
                  >
                    {text}
                    {lead === i ? <i aria-label="leads this measure">▲</i> : null}
                  </dd>
                ))}
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
