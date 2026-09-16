/**
 * The one-way ties as an adjacency matrix: rows give, columns receive, and the
 * diagonal is blank because "does A trust A" is not a question anyone was
 * asked.
 *
 * It lives in the detail band of the unreturned-trust tab, under the map of the
 * same ties. The map answers "who, and which way"; the grid answers "is this
 * group full of them, and are they all pointing the same way" — a solid row is
 * a person nobody returns, a solid column is a person everybody reaches for.
 * A wide, short band is the shape a matrix wants, which is why it moved here
 * from the sidebar toggle it used to hide behind.
 */

import { useMemo } from 'react';
import type { PersonProps } from './InsightsChrome.js';
import { POLARITY_STYLE, type TieMatrix } from './model.js';

/** Matrix geometry, in the SVG's own units — which are drawn 1:1 at full size. */
const MX = { cell: 20, rowLabel: 132, colHead: 88, pad: 8, headRight: 78 };
/** Row and column name lengths that fit their gutters at the sizes below. */
const MX_ROW_CHARS = 19;
const MX_COL_CHARS = 16;

function elide(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const MX_KIND_LABEL: Record<string, string> = {
  not_returned: 'not returned',
  no_basis: 'no basis',
  mutual: 'returned',
};

/**
 * Only the people with at least one unreturned tie appear — a matrix of the
 * whole cohort is mostly empty, and the emptiness is not the finding. The order
 * is the reason this drawing is worth having at all: sorted by cluster and then
 * by ties received inside each cluster, the one-way ties gather into blocks a
 * reader can point at. In roster order the same data is confetti, and strictly
 * worse than the list it sits beside.
 */
export function MatrixGrid({
  matrix,
  activeNo,
  nameOf,
  funcOf,
  personProps,
}: {
  matrix: TieMatrix;
  activeNo: number | null;
  nameOf: (no: number) => string;
  funcOf: (no: number) => string;
  personProps: PersonProps;
}) {
  const order = matrix.order;
  const n = order.length;
  const at = useMemo(() => new Map(order.map((no, i) => [no, i])), [order]);
  if (n === 0) return <p className="hint">Nothing to lay out as a grid yet.</p>;

  // The right pad is for the LAST rotated column header, which leans out
  // past its own column; without it the top-right name is clipped away.
  const W = MX.rowLabel + n * MX.cell + MX.headRight;
  const H = MX.colHead + n * MX.cell + MX.pad;
  const cellX = (i: number) => MX.rowLabel + i * MX.cell;
  const cellY = (i: number) => MX.colHead + i * MX.cell;
  const focusRow = activeNo !== null ? at.get(activeNo) : undefined;

  return (
    <div className="insights-matrix-wrap">
      <svg
        className="insights-matrix"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ maxWidth: W }}
        role="img"
        aria-label={`One-way trust ties as a grid: ${n} people, rows give and columns receive`}
      >
        {/* The focused person's row and column, lit as one band each. */}
        {focusRow !== undefined ? (
          <>
            <rect
              className="insights-matrix-band"
              x={0}
              y={cellY(focusRow)}
              width={W}
              height={MX.cell}
            />
            <rect
              className="insights-matrix-band"
              x={cellX(focusRow)}
              y={0}
              width={MX.cell}
              height={H}
            />
          </>
        ) : null}

        {order.map((_, i) => (
          <g key={`grid-${i}`}>
            <line
              className="insights-matrix-rule"
              x1={MX.rowLabel}
              y1={cellY(i)}
              x2={cellX(n)}
              y2={cellY(i)}
            />
            <line
              className="insights-matrix-rule"
              x1={cellX(i)}
              y1={MX.colHead}
              x2={cellX(i)}
              y2={cellY(n)}
            />
          </g>
        ))}
        <line className="insights-matrix-rule" x1={MX.rowLabel} y1={cellY(n)} x2={cellX(n)} y2={cellY(n)} />
        <line className="insights-matrix-rule" x1={cellX(n)} y1={MX.colHead} x2={cellX(n)} y2={cellY(n)} />

        {/* The diagonal is blanked rather than left white: an empty cell means
            "no tie", and a person cannot fail to trust themselves. */}
        {order.map((no, i) => (
          <rect
            key={`diag-${no}`}
            className="insights-matrix-diag"
            x={cellX(i) + 1}
            y={cellY(i) + 1}
            width={MX.cell - 2}
            height={MX.cell - 2}
            rx={3}
          />
        ))}

        {matrix.cells.map((c) => {
          const i = at.get(c.from);
          const j = at.get(c.to);
          if (i === undefined || j === undefined) return null;
          const oneWay = c.kind !== 'mutual';
          return (
            <rect
              key={`${c.from}>${c.to}`}
              className="insights-matrix-cell"
              x={cellX(j) + 1}
              y={cellY(i) + 1}
              width={MX.cell - 2}
              height={MX.cell - 2}
              rx={3}
              fill={oneWay ? POLARITY_STYLE.negative.color : POLARITY_STYLE.positive.color}
              opacity={c.kind === 'not_returned' ? 0.88 : c.kind === 'no_basis' ? 0.45 : 0.2}
              {...personProps(c.from, () => ({
                title: `${nameOf(c.from)} → ${nameOf(c.to)}`,
                sub: `${c.mean.toFixed(1)} · ${MX_KIND_LABEL[c.kind]}`,
                rows: [
                  ['Gives', `${nameOf(c.from)} · ${funcOf(c.from)}`],
                  ['Receives', `${nameOf(c.to)} · ${funcOf(c.to)}`],
                ],
              }))}
            />
          );
        })}

        {order.map((no, i) => (
          <text
            key={`row-${no}`}
            className={`insights-matrix-name${activeNo === no ? ' is-active' : ''}`}
            x={MX.rowLabel - 8}
            y={cellY(i) + MX.cell / 2 + 4}
            textAnchor="end"
            {...personProps(no, () => ({
              title: nameOf(no),
              sub: funcOf(no),
              rows: [
                ['One-way ties', String(matrix.involvement.get(no) ?? 0)],
                ['Ties received here', String(matrix.inDegree.get(no) ?? 0)],
              ],
            }))}
          >
            {elide(nameOf(no), MX_ROW_CHARS)}
          </text>
        ))}

        {order.map((no, i) => (
          <text
            key={`col-${no}`}
            className={`insights-matrix-name is-col${activeNo === no ? ' is-active' : ''}`}
            x={cellX(i) + MX.cell / 2}
            y={MX.colHead - 6}
            textAnchor="start"
            transform={`rotate(-45 ${cellX(i) + MX.cell / 2} ${MX.colHead - 6})`}
            {...personProps(no, () => ({
              title: nameOf(no),
              sub: funcOf(no),
              rows: [
                ['One-way ties', String(matrix.involvement.get(no) ?? 0)],
                ['Ties received here', String(matrix.inDegree.get(no) ?? 0)],
              ],
            }))}
          >
            {elide(nameOf(no), MX_COL_CHARS)}
          </text>
        ))}
      </svg>

      <div className="insights-legend">
        <span>
          <i style={{ background: POLARITY_STYLE.negative.color, opacity: 0.88 }} /> One way, rated back
        </span>
        <span>
          <i style={{ background: POLARITY_STYLE.negative.color, opacity: 0.45 }} /> One way, never rated back
        </span>
        <span>
          <i style={{ background: POLARITY_STYLE.positive.color, opacity: 0.2 }} /> Returned
        </span>
      </div>
      <p className="insights-hintline">
        Rows give trust, columns receive it. Ordered by cluster, then by ties received inside it.
        {matrix.capped ? ` Showing the ${matrix.limit} people with the most one-way ties.` : ''}
      </p>
    </div>
  );
}
