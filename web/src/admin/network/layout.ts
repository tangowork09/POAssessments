/**
 * Layouts for the cohort network views. Pure functions: nodes and edges in,
 * `{x, y}` per member out — React never sees a simulation tick.
 *
 * The force map runs d3-force to rest synchronously. Sixty nodes settle in a
 * few hundred iterations, well under a frame budget, and a settled answer is a
 * stable answer: polling re-runs seed from the previous positions, so a new
 * response nudges the picture instead of teleporting it.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';

export interface LayoutNode {
  no: number;
  /** Ties received under the current lens — sizes the node. */
  inTies: number;
  /** Group key for the clustered view ('' = ungrouped). */
  group: string;
}

export interface LayoutEdge {
  from: number;
  to: number;
  /** 0..1 — how strongly the pair pulls together in the force view. */
  weight: number;
}

export type Positions = Map<number, { x: number; y: number }>;

interface SimNode {
  id: number;
  x?: number;
  y?: number;
  r: number;
  group: string;
}

/** The world the layout solves in — pass the real canvas box so nodes scatter
 * across whatever space the screen actually gives them. */
export interface LayoutBox {
  w: number;
  h: number;
}
const DEFAULT_BOX: LayoutBox = { w: 1100, h: 720 };

/**
 * Stretch a settled constellation to actually inhabit the box. A force layout
 * relaxes into its own roundish shape no matter how wide the canvas is, and
 * the camera then fits by the limiting axis — leaving the other axis as dead
 * margin. Mapping the bounding box onto the padded canvas makes every layout
 * use the space it was given; relative neighbourhoods survive the stretch.
 */
function fillBox(positions: Positions, box: LayoutBox, pad = 70): Positions {
  const pts = [...positions.values()];
  if (pts.length < 2) return positions;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const outW = Math.max(1, box.w - pad * 2);
  const outH = Math.max(1, box.h - pad * 2);
  const out: Positions = new Map();
  for (const [k, p] of positions) {
    out.set(k, {
      x: pad + ((p.x - minX) / spanX) * outW,
      y: pad + ((p.y - minY) / spanY) * outH,
    });
  }
  return out;
}

export function nodeRadius(inTies: number, max: number): number {
  if (max <= 0) return 15;
  return 14 + Math.round((inTies / max) * 18);
}

/** The force "map": one settled d3-force pass, seeded from previous positions. */
export function forceMapLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  previous: Positions,
  box: LayoutBox = DEFAULT_BOX,
): Positions {
  const { w: W, h: H } = box;
  const maxIn = Math.max(0, ...nodes.map((n) => n.inTies));
  const simNodes: SimNode[] = nodes.map((n, i) => ({
    id: n.no,
    r: nodeRadius(n.inTies, maxIn),
    group: n.group,
    // Seed: last known place, or a ring — d3's default spiral piles roster
    // order into the centre, which reads as meaning where there is none.
    x: previous.get(n.no)?.x ?? W / 2 + Math.cos((i / Math.max(1, nodes.length)) * 2 * Math.PI) * 220,
    y: previous.get(n.no)?.y ?? H / 2 + Math.sin((i / Math.max(1, nodes.length)) * 2 * Math.PI) * 180,
  }));
  const byNo = new Map(simNodes.map((n) => [n.id, n]));
  const links = edges
    .filter((e) => byNo.has(e.from) && byNo.has(e.to))
    .map((e) => ({ source: e.from, target: e.to, weight: e.weight }));

  // A layout that already has homes for nearly everyone is a *reheat*, not a
  // fresh solve: low alpha, few ticks, so nodes settle where they were instead
  // of the whole cloud swirling to a new (rotated) equilibrium every refresh.
  const seeded =
    simNodes.length > 0 &&
    simNodes.filter((n) => previous.has(n.id)).length / simNodes.length > 0.9;

  const sim = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-520).distanceMax(480))
    .force(
      'link',
      forceLink(links)
        .id((d) => (d as SimNode).id)
        .distance((l) => 150 - 60 * (l as unknown as { weight: number }).weight)
        .strength((l) => 0.25 + 0.5 * (l as unknown as { weight: number }).weight),
    )
    .force('collide', forceCollide<SimNode>().radius((d) => d.r + 16).strength(1))
    .force('center', forceCenter(W / 2, H / 2))
    .stop();

  if (seeded) {
    // Weak springs back to each node's previous seat remove the layout's
    // rotational freedom — new data nudges neighbours locally instead of
    // slowly spinning the whole constellation.
    sim
      .force('ax', forceX<SimNode>((d) => previous.get(d.id)?.x ?? W / 2).strength(0.08))
      .force('ay', forceY<SimNode>((d) => previous.get(d.id)?.y ?? H / 2).strength(0.08))
      .alpha(0.15);
  }
  for (let i = 0, n = seeded ? 120 : 400; i < n; i++) sim.tick();
  return fillBox(new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])), box);
}

/**
 * The layered "flow" view: rows by ties received (most chosen on top), column
 * order by one barycenter sweep so arrows mostly flow short distances.
 * Deterministic — the same data always draws the same picture, which is what
 * makes a refresh readable.
 */
export function layeredLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  box: LayoutBox = DEFAULT_BOX,
): Positions {
  const { w: W, h: H } = box;
  if (nodes.length === 0) return new Map();
  const maxIn = Math.max(1, ...nodes.map((n) => n.inTies));
  const rowCount = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(nodes.length / 2)) + 1));
  const rowOf = (n: LayoutNode): number =>
    // Highest in-degree → row 0. Zero ties always lands in the bottom row.
    n.inTies === 0 ? rowCount - 1 : Math.min(rowCount - 2, Math.floor((1 - n.inTies / maxIn) * (rowCount - 1)));

  const rows: LayoutNode[][] = Array.from({ length: rowCount }, () => []);
  for (const n of [...nodes].sort((a, b) => b.inTies - a.inTies || a.no - b.no)) rows[rowOf(n)]!.push(n);

  // One barycenter pass, top-down: order each row by the mean column of the
  // neighbours already placed above it.
  const col = new Map<number, number>();
  rows[0]!.forEach((n, i) => col.set(n.no, i));
  const neighbours = new Map<number, number[]>();
  for (const e of edges) {
    (neighbours.get(e.from) ?? neighbours.set(e.from, []).get(e.from)!).push(e.to);
    (neighbours.get(e.to) ?? neighbours.set(e.to, []).get(e.to)!).push(e.from);
  }
  for (let r = 1; r < rowCount; r++) {
    rows[r] = rows[r]!
      .map((n) => {
        const placed = (neighbours.get(n.no) ?? []).filter((m) => col.has(m));
        const bary =
          placed.length > 0 ? placed.reduce((s, m) => s + col.get(m)!, 0) / placed.length : Number.MAX_SAFE_INTEGER;
        return { n, bary };
      })
      .sort((a, b) => a.bary - b.bary || a.n.no - b.n.no)
      .map(({ n }) => n);
    rows[r]!.forEach((n, i) => col.set(n.no, i));
  }

  const out: Positions = new Map();
  const rowGap = Math.max(120, H / rowCount);
  rows.forEach((row, r) => {
    const gap = Math.min(260, (W - 140) / Math.max(1, row.length));
    const left = W / 2 - (gap * (row.length - 1)) / 2;
    row.forEach((n, i) => out.set(n.no, { x: left + i * gap, y: 60 + r * rowGap }));
  });
  return out;
}

/**
 * The circular view: every node evenly spaced on one ring, ordered by group
 * then ties received, so all directed ties are drawn as chords across the
 * circle. The classic sociogram layout — nothing is hidden behind a force
 * cluster, and the shape of who-points-where is read straight off the rim.
 */
export function circularLayout(
  nodes: LayoutNode[],
  _edges: LayoutEdge[],
  box: LayoutBox = DEFAULT_BOX,
): Positions {
  const { w: W, h: H } = box;
  const ordered = [...nodes].sort(
    (a, b) => a.group.localeCompare(b.group) || b.inTies - a.inTies || a.no - b.no,
  );
  const n = ordered.length;
  const cx = W / 2;
  const cy = H / 2;
  const rx = W / 2 - 90;
  const ry = H / 2 - 80;
  const out: Positions = new Map();
  ordered.forEach((node, i) => {
    const angle = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2;
    out.set(node.no, { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  });
  return out;
}

/**
 * The grouped view: one force pass with an extra pull toward each group's own
 * centroid, so functions (or assignment groups) gather without losing the
 * cross-group edges that are the point of looking.
 */
export function groupedLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  previous: Positions,
  box: LayoutBox = DEFAULT_BOX,
): { positions: Positions; centroids: Map<string, { x: number; y: number }> } {
  const { w: W, h: H } = box;
  const groups = [...new Set(nodes.map((n) => n.group))].sort();
  const centroids = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(groups.length));
  groups.forEach((g, i) => {
    centroids.set(g, {
      x: (W / (cols + 1)) * ((i % cols) + 1),
      y: (H / (Math.ceil(groups.length / cols) + 1)) * (Math.floor(i / cols) + 1),
    });
  });

  const maxIn = Math.max(0, ...nodes.map((n) => n.inTies));
  const simNodes: SimNode[] = nodes.map((n) => ({
    id: n.no,
    r: nodeRadius(n.inTies, maxIn),
    group: n.group,
    x: previous.get(n.no)?.x ?? centroids.get(n.group)!.x + (Math.sin(n.no * 7) * 60),
    y: previous.get(n.no)?.y ?? centroids.get(n.group)!.y + (Math.cos(n.no * 7) * 60),
  }));
  const byNo = new Map(simNodes.map((n) => [n.id, n]));
  const links = edges
    .filter((e) => byNo.has(e.from) && byNo.has(e.to))
    .map((e) => ({ source: e.from, target: e.to, weight: e.weight }));

  const sim = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-220))
    .force(
      'link',
      forceLink(links)
        .id((d) => (d as SimNode).id)
        .distance(140)
        .strength(0.08),
    )
    .force('collide', forceCollide<SimNode>().radius((d) => d.r + 12))
    .force('gx', forceX<SimNode>((d) => centroids.get(d.group)?.x ?? W / 2).strength(0.28))
    .force('gy', forceY<SimNode>((d) => centroids.get(d.group)?.y ?? H / 2).strength(0.28))
    .stop();
  const seeded =
    simNodes.length > 0 &&
    simNodes.filter((n) => previous.has(n.id)).length / simNodes.length > 0.9;
  if (seeded) sim.alpha(0.18);
  for (let i = 0, n = seeded ? 120 : 300; i < n; i++) sim.tick();

  return {
    positions: fillBox(new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])), box),
    centroids,
  };
}
