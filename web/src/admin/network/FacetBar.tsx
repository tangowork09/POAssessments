/**
 * One facet's bar: the density as a percentage, the raw fraction beneath.
 *
 * Its own module so the rail panel and the Insights page draw the identical
 * bar. Reliability and openness are the same measurement twice, and two
 * slightly different drawings of them would invite the reader to believe the
 * difference is in the data.
 */

import type { LensDensity } from './model.js';

export function FacetBar({
  label,
  stat,
  color,
}: {
  label: string;
  stat: LensDensity;
  color: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--ink)' }}>{label}</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ink)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {stat.density === null ? '—' : `${Math.round(stat.density * 100)}%`}
        </span>
      </div>
      <span className="net-bar-track" style={{ display: 'block', margin: '4px 0 3px' }} aria-hidden="true">
        <span
          className="net-bar-fill"
          style={{ width: `${Math.round((stat.density ?? 0) * 100)}%`, background: color }}
        />
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
        {stat.ties} of {stat.ratedPairs} rated pairs
      </span>
    </div>
  );
}
