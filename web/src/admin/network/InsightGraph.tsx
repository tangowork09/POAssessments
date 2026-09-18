/**
 * ONE map, nine questions.
 *
 * Seven of the nine insight tabs are answered by a picture of the same network,
 * and the reason the workspace works at all is that it is literally the same
 * picture: the seats are solved once, from the trust ties, in a virtual box a
 * thousand units wide, and every tab is handed those positions. Switching tabs
 * re-themes the constellation — different sizes, different rings, different
 * ties, a different half of it faded back — and never moves anybody.
 *
 * That is a finding in itself, not a performance trick. A client watching the
 * same arrangement of their own people answer nine questions in a row learns
 * where each person sits once and then reads structure; a client watching nine
 * force layouts re-settle learns nothing and trusts less.
 *
 * So this component takes no view of what a tab means. It is handed the ties to
 * draw, a size for each node, a colour, a fade, whatever rings the tab wants
 * hung on which people, optional territories and margin annotations — and it
 * draws exactly that, with the page's one hover/focus vocabulary attached.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import type { CohortNetwork } from '../../../../src/shared/types.js';
import { zoomToBox } from './layout.js';
import type { LayoutBox, Positions } from './layout.js';
import {
  boxesOverlap,
  cullLabels,
  POLARITY_STYLE,
  roundedHullPath,
  textBox,
  tieOpacity,
  tiePath,
  tieWidth,
  type Callout,
  type ClusterHull,
  type LabelBox,
  type PaneEdge,
} from './model.js';

/**
 * What a tab hangs on one person.
 *
 * `rings` is an array rather than a colour because "on both lists" is a real
 * answer on the anchors tab and it has to be visible without a legend: one ring
 * is one standing, two concentric rings are two.
 */
export interface NodeDecor {
  /** Solid rings outside the node, innermost first. */
  rings?: readonly string[];
  /** A soft dashed ring — a flag (an isolate, a risk), not a rank. */
  warn?: string;
}

/** Name size in the map's own units, at the default thousand-unit box. */
const LABEL_SIZE = 19;
/** Width of the lane down the right edge that holds the unconnected. */
export const DOCK_W = 132;
/** How far outside a node the first decoration ring sits. */
const RING_GAP = 7;
/** A marker id per tie colour: '#0E7C5A' is not valid inside `url(#...)`. */
function arrowId(color: string): string {
  return `ins-graph-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** And the step between concentric rings. */
const RING_STEP = 7;

export interface InsightGraphProps {
  nodes: CohortNetwork['nodes'];
  /** Solved once per cohort, shared by every map tab. Never re-solved here. */
  positions: Positions;
  /** The virtual box those positions were solved in. */
  box: LayoutBox;
  /** The ties THIS tab draws. An empty list is a legitimate answer. */
  edges: readonly PaneEdge[];
  /** Node radius in box units — usually `nodeRadius` over that tab's metric. */
  sizeOf: (no: number) => number;
  /**
   * Multiplier on every radius. Radii are in map units and the box is always
   * a thousand wide, so a short, wide stage would draw the same dots larger
   * against less room; the caller scales them to the stage it measured.
   */
  sizeScale?: number;
  colorOf: (no: number) => string;
  /** 0..1 per person, before focus overrides it. Absent = everyone at full. */
  fadeOf?: (no: number) => number;
  /** 0..1 per tie. Absent = the shared positive-tie opacity. */
  edgeFadeOf?: (e: PaneEdge) => number;
  /** Rings and flags. Called for every drawn node; null for most of them. */
  decorate?: (no: number) => NodeDecor | null;
  /** Who may carry a standing name. The focused person always may, regardless. */
  labelFor?: ReadonlySet<number>;
  /**
   * Naming everyone. The seats stay the same size in map units, so this is
   * only a signal to the stylesheet to set smaller type — a smaller name is a
   * smaller box, and more of them clear their neighbours.
   */
  denseLabels?: boolean;
  /** Community territories, drawn behind everything. */
  hulls?: readonly ClusterHull[];
  /**
   * Side-by-side regions, one per group, drawn as labelled panels behind the
   * people seated in them. Used when the reader asked to compare groups: a
   * tie that crosses a lane boundary is visibly a tie that crosses the
   * boundary, which no shared cloud can show.
   */
  lanes?: readonly { label: string; color: string; x: number; y: number; w: number; h: number; note?: string }[];
  /** A transient set the reader is pointing at — lifts them, pushes the rest back. */
  highlight?: ReadonlySet<number> | null;
  /** Margin annotations, already placed by `placeCallouts` in this same box. */
  callouts?: readonly Callout[];
  /** Room either side of the field for those annotations. */
  margin?: number;
  /**
   * People with no positive trust tie at all, parked in a lane down the right
   * edge rather than left to stretch the constellation: they have no place in
   * it, and a seat they were pushed to would read as one.
   */
  dock?: { members: readonly number[]; label: string } | null;
  /**
   * Point at a person and their ties light up while everyone else steps back
   * a little — the picture answers "who is this person connected to" before
   * the tooltip has finished appearing.
   */
  /**
   * Light a person's ties on hover, as a preview of what clicking them shows.
   *
   * This is dimming only. It never re-seats a name and never isolates: both of
   * those follow the click. Re-solving sixty labels or re-fitting the map under
   * a moving pointer is what made the picture flicker and never settle.
   */
  egoOnHover?: boolean;
  /** Draw arrowheads: for a tab whose whole claim is the direction of a tie. */
  directed?: boolean;
  /**
   * Show only the focused person and whoever they are tied to, refitted to
   * fill the frame.
   *
   * Dimming the rest is enough to read on screen and not enough to take away:
   * a picture of one person's neighbourhood still carries sixty faded names
   * and every other tie, which is both unreadable and more than anybody
   * needed to be given.
   */
  isolate?: boolean;
  /** The primary tie set's colour. Defaults to the shared positive-tie green. */
  edgeColor?: string;
  /** What the primary tie set is called, for a tie's own tooltip. */
  edgeLabel?: string;
  /**
   * A second tie set under a different lens, drawn in its own colour beneath
   * the primary one. For a tab whose claim is that two networks do not overlap:
   * the reader has to see both to see that.
   */
  overlay?: { edges: readonly PaneEdge[]; color: string; label: string } | null;
  /**
   * Hover/click handlers for one pair's tie. A tie is two or three pixels
   * wide, so the handlers go on a transparent stroke laid over it rather than
   * on the visible line, which is far too thin to be a target.
   *
   * One target per ordered pair, never one per layer: where a pair carries a
   * tie under both lenses the two lines are coincident, and stacking two
   * invisible targets would make whichever sits underneath unreachable. The
   * callback is handed every lens the pair appears in instead.
   */
  tieProps?: (
    edge: PaneEdge,
    lenses: { label: string; color: string; mean: number }[],
  ) => Record<string, unknown>;
  /** The page's focused person — ringed, named, never faded, on every tab. */
  activeNo?: number | null;
  onPick?: (no: number) => void;
  onHover?: (no: number, e: React.MouseEvent) => void;
  onLeave?: () => void;
  label: string;
}

function InsightGraphImpl({
  nodes,
  positions,
  box,
  edges,
  sizeOf: rawSizeOf,
  sizeScale = 1,
  colorOf,
  fadeOf,
  edgeFadeOf,
  decorate,
  labelFor,
  denseLabels = false,
  hulls,
  lanes,
  highlight,
  callouts,
  margin = 0,
  directed = false,
  isolate = false,
  edgeColor = POLARITY_STYLE.positive.color,
  edgeLabel = 'Tie',
  overlay = null,
  tieProps,
  activeNo = null,
  dock = null,
  egoOnHover = true,
  onPick,
  onHover,
  onLeave,
  label,
}: InsightGraphProps) {
  const sizeOf = useCallback((no: number) => rawSizeOf(no) * sizeScale, [rawSizeOf, sizeScale]);



  /** The node plus whatever rings it wears — the edge a name has to clear. */
  const outerOf = useCallback(
    (no: number) => {
      const d = decorate?.(no) ?? null;
      const rings = (d?.rings?.length ?? 0) + (d?.warn ? 1 : 0);
      return sizeOf(no) + (rings > 0 ? RING_GAP + (rings - 1) * RING_STEP + 3 : 0);
    },
    [decorate, sizeOf],
  );
  const [hoverNo, setHoverNo] = useState<number | null>(null);
  /**
   * The person under the pointer, or the one picked, together with everyone
   * they are tied to.
   *
   * A pick holds it: reading "who is around this person" is not something you
   * do while keeping the mouse still, and it survives until they are cleared.
   * Hover still previews it for anybody else.
   */
  const neighboursOf = useCallback(
    (no: number | null) => {
      if (no === null) return null;
      const set = new Set<number>([no]);
      for (const e of edges) {
        if (e.from === no) set.add(e.to);
        if (e.to === no) set.add(e.from);
      }
      for (const e of overlay?.edges ?? []) {
        if (e.from === no) set.add(e.to);
        if (e.to === no) set.add(e.from);
      }
      return set;
    },
    [edges, overlay],
  );

  /**
   * The held selection's neighbourhood. Labels and isolation follow THIS and
   * never the hover: seating sixty names is a collision solve, and re-running
   * it on every pointer move made the whole map flicker as names jumped
   * between seats. A hover dims; only a click re-letters the picture.
   */
  const stickyEgo = useMemo(() => neighboursOf(activeNo), [activeNo, neighboursOf]);
  /** The hover's neighbourhood, for dimming alone. */
  const hoverEgo = useMemo(
    () => (egoOnHover ? neighboursOf(hoverNo) : null),
    [egoOnHover, hoverNo, neighboursOf],
  );
  const ego = hoverEgo ?? stickyEgo;
  // The hover ego is a highlight like any other, but it never replaces a
  // highlight the tab itself is holding (a silos row, a facet bar).
  const group = highlight && highlight.size > 0 ? highlight : ego;

  /** Isolation only bites on a held selection, never on a passing hover. */
  const isolated = isolate && stickyEgo !== null && stickyEgo.size > 0 ? stickyEgo : null;
  const shownNodes = useMemo(
    () => (isolated ? nodes.filter((n) => isolated.has(n.no)) : nodes),
    [isolated, nodes],
  );
  const shownPositions = useMemo(
    () => (isolated ? zoomToBox(positions, isolated, box) : positions),
    [box, isolated, positions],
  );
  const keepEdge = useCallback(
    (e: PaneEdge) => !isolated || (isolated.has(e.from) && isolated.has(e.to)),
    [isolated],
  );

  const tieLayers = useMemo(
    () =>
      (overlay
        ? [
            { set: overlay.edges, color: overlay.color, label: overlay.label },
            { set: edges, color: edgeColor, label: edgeLabel },
          ]
        : [{ set: edges, color: edgeColor, label: edgeLabel }]
      ).map((l) => ({ ...l, set: l.set.filter(keepEdge) })),
    [edgeColor, edgeLabel, edges, keepEdge, overlay],
  );
  const tieTargets = useMemo(() => {
    const byPair = new Map<
      string,
      { edge: PaneEdge; lenses: { label: string; color: string; mean: number }[] }
    >();
    for (const layer of tieLayers) {
      for (const e of layer.set) {
        const key = `${e.from}>${e.to}`;
        const hit = byPair.get(key);
        const lens = { label: layer.label, color: layer.color, mean: e.mean };
        // The first layer to claim a pair owns the geometry; a later one only
        // adds its reading, so the target sits on a line that is really drawn.
        if (hit) hit.lenses.push(lens);
        else byPair.set(key, { edge: e, lenses: [lens] });
      }
    }
    return [...byPair.values()];
  }, [tieLayers]);

  /**
   * Names, placed greedily: the focused person first, then whoever the tab
   * nominated, biggest node first. Four seats each — under the node, over it,
   * then out to either side — and a seat is only offered if it clears every
   * OTHER person's mark as well as every name already standing. A name
   * printed across somebody else's dot names the wrong person, which is worse
   * than not naming anyone: every node carries a tooltip, so a culled label
   * costs ink and nothing else.
   */
  // Measured and drawn at the same size, always: a box measured larger than
  // the type it reserves space for culls names that would have fitted, and one
  // measured smaller lets names touch.
  const labelSize = denseLabels ? LABEL_SIZE * 0.76 : LABEL_SIZE;

  const placed = useMemo(() => {
    const wanted = isolated
      ? [...isolated]
      : [...new Set([...(labelFor ?? new Set<number>()), ...(stickyEgo ?? [])])];
    /** Every person's mark, as a box a name has to miss. */
    const marks = new Map<number, LabelBox>();
    // A lane's own header is furniture: no name may print across it either.
    (lanes ?? []).forEach((l, i) =>
      marks.set(-1000 - i, { x: l.x, y: l.y - 34, w: l.w, h: 34 }),
    );
    for (const n of nodes) {
      const p = shownPositions.get(n.no);
      if (!p) continue;
      const r = outerOf(n.no);
      marks.set(n.no, { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 });
    }
    if (activeNo !== null && !wanted.includes(activeNo)) wanted.push(activeNo);
    const nameOf = new Map(nodes.map((n) => [n.no, n.name]));
    const ordered = wanted.sort(
      (a, b) =>
        Number(b === activeNo) - Number(a === activeNo) || sizeOf(b) - sizeOf(a) || a - b,
    );
    return cullLabels(
      ordered.map((no) => {
        const p = shownPositions.get(no);
        const r = outerOf(no);
        if (!p) return { id: no, boxes: [] };
        const name = nameOf.get(no) ?? '';
        const seats: (LabelBox | null)[] = Array.from(
          { length: SEAT_OFFSETS.length * SEAT_RINGS },
          (_, i) => {
            const st = seatPoint(p, r, i);
            const b = textBox(name, st.x, st.y, labelSize, st.anchor);
            // A name has to land inside the picture, margin included.
            return b.x >= -margin + 2 &&
              b.x + b.w <= box.w + margin - 2 &&
              b.y >= 2 &&
              b.y + b.h <= box.h - 2
              ? b
              : null;
          },
        );
        // Its own mark is not an obstacle: the name is seated against it.
        return {
          id: no,
          boxes: seats.map((box) => {
            if (!box) return null;
            for (const [other, mark] of marks) {
              if (other === no) continue;
              // A hair of contact is fine — the name is stroked in the page
              // colour, so it reads over a rim. Crossing a dot is not.
              if (boxesOverlap(box, mark, -4)) return null;
            }
            return box;
          }),
        };
      }),
      [],
      labelSize * 0.3,
    );
  }, [activeNo, box.h, box.w, isolated, labelFor, labelSize, lanes, margin, nodes, outerOf, shownPositions, stickyEgo]);

  return (
    <svg
      className="ins-graph"
      viewBox={`${-margin} 0 ${box.w + margin * 2} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      {directed ? (
        <defs>
          {/* A marker carries its own fill, so each tie colour needs its own. */}
          {[edgeColor, ...(overlay ? [overlay.color] : [])].map((c) => (
            <marker
              key={c}
              id={arrowId(c)}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
            </marker>
          ))}
        </defs>
      ) : null}

      {(isolated ? [] : lanes ?? []).map((l) => (
        <g key={l.label} className="ins-lane">
          <rect x={l.x} y={l.y - 34} width={l.w} height={l.h + 34} rx={18} fill={l.color} fillOpacity={0.05} stroke={l.color} strokeOpacity={0.3} strokeWidth={2} />
          <circle cx={l.x + 20} cy={l.y - 14} r={7} fill={l.color} />
          <text x={l.x + 34} y={l.y - 8} className="ins-lane-label" style={{ fill: l.color }}>
            {l.label}
          </text>
          {l.note ? (
            <text x={l.x + l.w - 16} y={l.y - 8} textAnchor="end" className="ins-lane-note">
              {l.note}
            </text>
          ) : null}
        </g>
      ))}

      {!isolated && dock && dock.members.length > 0 ? (
        <g className="ins-dock" aria-hidden="true">
          <line x1={box.w - DOCK_W} y1={16} x2={box.w - DOCK_W} y2={box.h - 16} />
          <text x={box.w - DOCK_W / 2} y={24} textAnchor="middle" className="ins-dock-label">
            {dock.label}
          </text>
        </g>
      ) : null}

      {/* Territories first: the people are the data, the region is the note. */}
      {(hulls ?? []).map((h) => {
        const named = group ? h.members.some((no) => group.has(no)) : null;
        return (
          <path
            key={h.label}
            className="insights-hull"
            d={roundedHullPath(h.points, 16)}
            fill={h.fill}
            fillOpacity={named === null ? 0.06 : named ? 0.13 : 0.02}
            stroke={h.fill}
            strokeOpacity={named === null ? 0.28 : named ? 0.6 : 0.08}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        );
      })}

      {/* The overlay lens first, so the primary set reads on top of it. */}
      {tieLayers.map((layer) =>
        layer.set.map((e) => {
          const s = shownPositions.get(e.from);
          const t = shownPositions.get(e.to);
          if (!s || !t) return null;
          const onActive = e.from === activeNo || e.to === activeNo;
          // Emphasis follows the held selection, never the pointer: a tie that
          // thickens as the cursor passes is the same flicker in another form.
          const onEgo = egoOnHover && hoverNo !== null && (e.from === hoverNo || e.to === hoverNo);
          const inGroup = group ? group.has(e.from) && group.has(e.to) : true;
          const base = edgeFadeOf
            ? edgeFadeOf(e)
            : tieOpacity('positive', { dimmed: false, focused: onActive });
          return (
            <path
              key={`${layer.color}-${e.key}`}
              className="ins-graph-tie"
              d={tiePath({
                sx: s.x,
                sy: s.y,
                sr: sizeOf(e.from),
                tx: t.x,
                ty: t.y,
                tr: sizeOf(e.to),
                mutual: e.mutual,
                bend: e.bend,
              })}
              fill="none"
              stroke={layer.color}
              strokeWidth={tieWidth('positive', e.mean, onActive || onEgo)}
              strokeLinecap="round"
              opacity={inGroup ? (onActive || onEgo ? Math.max(base, 0.9) : base) : 0.04}
              markerEnd={directed ? `url(#${arrowId(layer.color)})` : undefined}
            />
          );
        }),
      )}

      {/* Targets, over every drawn tie and under every node: a transparent
          stroke wide enough to actually hit, one per pair. */}
      {tieProps
        ? tieTargets.map((t) => {
            const s2 = positions.get(t.edge.from);
            const t2 = positions.get(t.edge.to);
            if (!s2 || !t2) return null;
            return (
              <path
                key={`hit-${t.edge.key}`}
                className="ins-graph-tie-hit"
                d={tiePath({
                  sx: s2.x,
                  sy: s2.y,
                  sr: sizeOf(t.edge.from),
                  tx: t2.x,
                  ty: t2.y,
                  tr: sizeOf(t.edge.to),
                  mutual: t.edge.mutual,
                  bend: t.edge.bend,
                })}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                strokeLinecap="round"
                {...tieProps(t.edge, t.lenses)}
              />
            );
          })
        : null}

      {shownNodes.map((n) => {
        const p = shownPositions.get(n.no);
        if (!p) return null;
        const r = sizeOf(n.no);
        const active = n.no === activeNo;
        const decor = decorate?.(n.no) ?? null;
        // Focus outranks every fade on the page: the one person the reader is
        // holding on to is never the one who went quiet.
        const opacity = active ? 1 : group ? (group.has(n.no) ? 1 : 0.2) : fadeOf?.(n.no) ?? 1;
        return (
          <g
            key={n.no}
            className={`ins-graph-node${active ? ' is-active' : ''}`}
            role="img"
            aria-label={`${n.name}${n.func ? `, ${n.func}` : ''}`}
            opacity={opacity}
            style={{ cursor: onPick ? 'pointer' : 'default' }}
            onClick={onPick ? () => onPick(n.no) : undefined}
            onMouseEnter={(e) => {
              setHoverNo(n.no);
              onHover?.(n.no, e);
            }}
            onMouseMove={onHover ? (e) => onHover(n.no, e) : undefined}
            onMouseLeave={() => {
              setHoverNo(null);
              onLeave?.();
            }}
          >
            {active ? (
              <circle cx={p.x} cy={p.y} r={r + 11} fill="var(--ink)" opacity={0.2} />
            ) : null}
            {(decor?.rings ?? []).map((colour, i) => (
              <circle
                key={`${colour}-${i}`}
                cx={p.x}
                cy={p.y}
                r={r + RING_GAP + i * RING_STEP}
                fill="none"
                stroke={colour}
                strokeWidth={3.4}
                opacity={0.95}
              />
            ))}
            {decor?.warn ? (
              <circle
                cx={p.x}
                cy={p.y}
                r={r + RING_GAP + (decor.rings?.length ?? 0) * RING_STEP}
                fill="none"
                stroke={decor.warn}
                strokeWidth={3}
                strokeDasharray="7 6"
                strokeLinecap="round"
                opacity={0.85}
              />
            ) : null}
            <circle
              cx={p.x}
              cy={p.y}
              r={r}
              fill={colorOf(n.no)}
              stroke={active ? 'var(--ink)' : '#fff'}
              strokeWidth={active ? 5 : 2.4}
            />
          </g>
        );
      })}

      {/* Names in their own pass. Drawn inside the node loop, the very next
          circle paints over the name just written. */}
      {shownNodes.map((n) => {
        const seat = placed.get(n.no);
        if (seat === undefined) return null;
        const p = shownPositions.get(n.no);
        if (!p) return null;
        const active = n.no === activeNo;
        const opacity = active ? 1 : group ? (group.has(n.no) ? 1 : 0.2) : fadeOf?.(n.no) ?? 1;
        const r = outerOf(n.no);
        const st = seatPoint(p, r, seat);
        // A name seated out on a ring is tied back to its own mark.
        const lead = st.ring > 0;
        const ux = st.x - p.x;
        const uy = st.y - labelSize * 0.34 - p.y;
        const len = Math.hypot(ux, uy) || 1;
        return (
          <g key={n.no} opacity={opacity}>
            {lead ? (
              <line
                className="insights-map-lead"
                x1={p.x + (ux / len) * (r + 2)}
                y1={p.y + (uy / len) * (r + 2)}
                x2={st.x - (ux / len) * 4}
                y2={st.y - labelSize * 0.34 - (uy / len) * 4}
              />
            ) : null}
            <text
              x={st.x}
              y={st.y}
              textAnchor={st.anchor}
              className={`insights-map-name${active ? ' is-active' : ''}`}
              style={{ fontSize: LABEL_SIZE, fontWeight: active ? 780 : 640, strokeWidth: 5 }}
            >
              {n.name}
            </text>
          </g>
        );
      })}

      {/* Margin annotations last, over everything: nothing on the map may be
          printed across the names the tab is actually about. */}
      {(callouts ?? []).map((c) => (
        <g key={c.no} className="insights-callout">
          <line x1={c.line.x1} y1={c.line.y1} x2={c.line.x2} y2={c.line.y2} />
          <text x={c.x} y={c.y + 5} textAnchor={c.anchor} className="insights-callout-text">
            {c.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Where a name may sit, in preference order: under its dot, over it, out to
 * either side, then the four diagonals. Eight seats rather than two is what
 * lets a crowded map keep its names — each one is still attached to its own
 * mark, and none of them may cross anybody else's.
 */
const SEAT_OFFSETS: readonly { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }[] = [
  { dx: 0, dy: 1, anchor: 'middle' },
  { dx: 0, dy: -1, anchor: 'middle' },
  { dx: 1, dy: 0, anchor: 'start' },
  { dx: -1, dy: 0, anchor: 'end' },
  { dx: 0.78, dy: 0.78, anchor: 'start' },
  { dx: -0.78, dy: 0.78, anchor: 'end' },
  { dx: 0.78, dy: -0.78, anchor: 'start' },
  { dx: -0.78, dy: -0.78, anchor: 'end' },
];

/**
 * How far out the rings of seats sit. A name that cannot sit against its own
 * dot is offered a place further out — and gets a hairline back to the mark
 * it belongs to, the same way the margin callouts work. Three rings is
 * enough: past that the leader line is longer than the name is useful.
 */
const SEAT_RINGS = 3;
const RING_STEP_OUT = LABEL_SIZE * 1.7;

/** A seat's position. Seats 0-7 hug the dot; 8+ step outward by a ring. */
function seatPoint(
  p: { x: number; y: number },
  r: number,
  i: number,
): { x: number; y: number; anchor: 'start' | 'middle' | 'end'; ring: number } {
  const ring = Math.floor(i / SEAT_OFFSETS.length);
  const o = SEAT_OFFSETS[i % SEAT_OFFSETS.length] ?? SEAT_OFFSETS[0]!;
  const out = r + 7 + ring * RING_STEP_OUT;
  return {
    x: p.x + o.dx * out,
    y: p.y + o.dy * (out + LABEL_SIZE * 0.9) + (o.dy === 0 ? LABEL_SIZE * 0.34 : o.dy > 0 ? LABEL_SIZE * 0.5 : 0),
    anchor: o.anchor,
    ring,
  };
}

export const InsightGraph = memo(InsightGraphImpl);
