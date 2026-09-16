/**
 * Network primitives for Collaboration Sociometry.
 *
 * The scoring engine answers "how is each person seen?"; these four functions
 * answer the questions that only exist at the level of the wiring itself:
 *
 *   - who sits on the paths between others      (betweenness)
 *   - where the group actually divides          (communities)
 *   - which reaching-out is not returned        (unreciprocatedTies)
 *   - how far a subgroup talks to itself        (subgroupCohesion)
 *
 * All four take a plain node list and a plain directed tie list, so the caller
 * decides what a tie *is* — overall, one block, or one of the single-item
 * trust lenses — and the same code serves every view. Nothing here reads the
 * instrument: a tie is a tie by the time it arrives.
 *
 * Two habits from the rest of the engine carry over. Absence is never zero: a
 * rate with nothing behind it is null rather than 0, because "nobody works
 * together here" and "everybody works together badly" are opposite findings.
 * And the group is small and named, so a subgroup too small to hide an
 * individual inside is suppressed rather than averaged.
 *
 * Pure and dependency-free: the same code runs in the Worker, in the browser
 * and under Vitest. Every function is deterministic — the same input yields
 * the same output, down to iteration order — because a report that renumbered
 * its own communities between two runs would be unreadable.
 */

export interface DirectedTie {
  from: number;
  to: number;
}

// ------------------------------------------------------------- betweenness

/**
 * Directed, unweighted betweenness centrality by Brandes' algorithm: for each
 * node, the share of shortest paths between *other* pairs that run through it.
 *
 * This is the broker measure. A person can hold few ties and still be the only
 * route between two halves of a group, and that is a structural fact about the
 * group's dependence on them rather than a compliment — which is why it is
 * reported next to, not instead of, the tie counts.
 *
 * Normalised by (n-1)(n-2), the number of ordered pairs a node could possibly
 * sit between, so values run 0..1 and two cohorts of different sizes can be
 * read against each other. Below three nodes there are no such pairs at all
 * and every score is 0. Self-ties, and ties touching anyone off the node list,
 * are ignored.
 */
export function betweenness(
  nodes: readonly number[],
  ties: readonly DirectedTie[],
): Map<number, number> {
  const ids = dedupe(nodes);
  const out = new Map<number, number>(ids.map((id) => [id, 0]));
  const n = ids.length;
  if (n < 3) return out;

  const index = new Map(ids.map((id, i) => [id, i]));
  // Sorted, de-duplicated adjacency: the algorithm's sums are order-sensitive
  // in floating point, so the traversal order is pinned to the node ids rather
  // than to the order ties happened to arrive in.
  const adj: number[][] = ids.map(() => []);
  const seen = new Set<string>();
  for (const t of ties) {
    if (t.from === t.to) continue;
    const a = index.get(t.from);
    const b = index.get(t.to);
    if (a === undefined || b === undefined) continue;
    const key = `${a}>${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    adj[a]!.push(b);
  }
  for (const list of adj) list.sort((x, y) => x - y);

  const score = new Array<number>(n).fill(0);

  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const preds: number[][] = ids.map(() => []);
    const sigma = new Array<number>(n).fill(0);
    const dist = new Array<number>(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;

    const queue: number[] = [s];
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]!;
      stack.push(v);
      for (const w of adj[v]!) {
        if (dist[w]! < 0) {
          dist[w] = dist[v]! + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v]! + 1) {
          sigma[w] = sigma[w]! + sigma[v]!;
          preds[w]!.push(v);
        }
      }
    }

    const delta = new Array<number>(n).fill(0);
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i]!;
      for (const v of preds[w]!) {
        delta[v] = delta[v]! + (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      }
      // Directed graphs count each ordered pair once, so there is no halving.
      if (w !== s) score[w] = score[w]! + delta[w]!;
    }
  }

  const scale = (n - 1) * (n - 2);
  for (let i = 0; i < n; i++) out.set(ids[i]!, score[i]! / scale);
  return out;
}

// -------------------------------------------------------------- communities

/**
 * Label propagation on the undirected projection: an edge exists between two
 * people if a tie runs between them in either direction. Returns each node's
 * community id, numbered 0, 1, 2, ... in order of their smallest member.
 *
 * Direction is dropped deliberately. Asking "where does this group divide?" is
 * a question about who is in contact with whom; a one-way tie still says these
 * two people are in each other's working world, and requiring reciprocity here
 * would split a group along its rating habits rather than along its seams.
 *
 * Determinism is the whole difficulty with label propagation, and it is bought
 * three ways: every node starts labelled with its own id; nodes are visited in
 * ascending id order; and a tie between candidate labels always goes to the
 * smallest. Sweeps stop when nothing moves, or after 100 — a cap that no
 * cohort-sized graph should ever reach.
 *
 * Two departures from the textbook rule, both needed to make it behave:
 *
 *   - Sweeps are applied in lockstep (every node reads the previous sweep's
 *     labels) rather than one node seeing the last node's new label. The
 *     sequential form lets a single bridge tie drag one cluster's label across
 *     into the other before either cluster has settled, which collapses two
 *     genuinely separate groups joined by one relationship into one community
 *     — the exact shape this function exists to detect.
 *   - A node counts its own current label as one vote alongside its
 *     neighbours'. This only decides ties, and it is what stops two connected
 *     nodes from swapping labels with each other forever.
 */
export function communities(
  nodes: readonly number[],
  ties: readonly DirectedTie[],
): Map<number, number> {
  const ids = dedupe(nodes).sort((a, b) => a - b);
  const out = new Map<number, number>();
  if (ids.length === 0) return out;

  const present = new Set(ids);
  const neighbours = new Map<number, Set<number>>(ids.map((id) => [id, new Set<number>()]));
  for (const t of ties) {
    if (t.from === t.to) continue;
    if (!present.has(t.from) || !present.has(t.to)) continue;
    neighbours.get(t.from)!.add(t.to);
    neighbours.get(t.to)!.add(t.from);
  }

  let labels = new Map<number, number>(ids.map((id) => [id, id]));

  for (let sweep = 0; sweep < 100; sweep++) {
    const next = new Map<number, number>();
    let moved = false;

    for (const id of ids) {
      const own = labels.get(id)!;
      const counts = new Map<number, number>([[own, 1]]);
      for (const nb of sortedOf(neighbours.get(id)!)) {
        const label = labels.get(nb)!;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }

      let best = own;
      let bestCount = 0;
      for (const [label, count] of counts) {
        if (count > bestCount || (count === bestCount && label < best)) {
          best = label;
          bestCount = count;
        }
      }

      if (best !== own) moved = true;
      next.set(id, best);
    }

    labels = next;
    if (!moved) break;
  }

  // Renumber to 0, 1, 2, ... by each community's smallest member, so the ids
  // mean the same thing on every run and read in roster order in a report.
  const members = new Map<number, number[]>();
  for (const id of ids) {
    const label = labels.get(id)!;
    const list = members.get(label);
    if (list) list.push(id);
    else members.set(label, [id]);
  }
  const ordered = [...members.values()].sort((a, b) => a[0]! - b[0]!);
  ordered.forEach((group, communityId) => {
    for (const id of group) out.set(id, communityId);
  });

  return out;
}

// -------------------------------------------------------- unreciprocated ties

export interface UnreciprocatedTie {
  a: number;
  b: number;
  /** The mean behind a's tie to b, under whichever lens the caller passed. */
  aToB: number;
  /** b's mean back to a, or null when b never rated a under this lens. */
  bToA: number | null;
  kind: 'not_returned' | 'no_basis';
  /** aToB - bToA, 2dp. null for 'no_basis', where there is nothing to subtract. */
  gap: number | null;
}

/**
 * Ordered pairs where a reaches out and the reach is not returned.
 *
 * The two kinds are different findings and are never merged. `not_returned` is
 * a rated pair: b knows a well enough to have an opinion and put it below the
 * tie line — an asymmetry the group is living with. `no_basis` is b never
 * rating a at all, which is usually seniority or distance, not rejection, and
 * carries no gap because there is no second number to compare against.
 *
 * Input is one entry per ordered pair, carrying that pair's mean under one
 * lens; a null mean means the pair was not rated under this lens and is
 * treated exactly as a missing entry. Pairs that tie in both directions are
 * reciprocated and never appear. Sorted with the rated asymmetries first, by
 * how wide the gap is, then the unrated ones by how strongly a reached out.
 */
export function unreciprocatedTies(
  edges: readonly { from: number; to: number; mean: number | null }[],
  tieThreshold: number,
): UnreciprocatedTie[] {
  const meanOf = new Map<string, number>();
  for (const e of edges) {
    if (e.mean === null || e.from === e.to) continue;
    meanOf.set(`${e.from}>${e.to}`, e.mean);
  }

  const out: UnreciprocatedTie[] = [];
  for (const e of edges) {
    if (e.mean === null || e.from === e.to) continue;
    if (e.mean < tieThreshold) continue;
    const back = meanOf.get(`${e.to}>${e.from}`);
    if (back !== undefined && back >= tieThreshold) continue; // reciprocated
    out.push(
      back === undefined
        ? { a: e.from, b: e.to, aToB: e.mean, bToA: null, kind: 'no_basis', gap: null }
        : {
            a: e.from,
            b: e.to,
            aToB: e.mean,
            bToA: back,
            kind: 'not_returned',
            gap: round2(e.mean - back),
          },
    );
  }

  const rank = (t: UnreciprocatedTie): number => (t.kind === 'not_returned' ? 0 : 1);
  return out.sort(
    (x, y) =>
      rank(x) - rank(y) ||
      (y.gap ?? 0) - (x.gap ?? 0) ||
      y.aToB - x.aToB ||
      x.a - y.a ||
      x.b - y.b,
  );
}

// -------------------------------------------------------- subgroup cohesion

export interface SubgroupTieStats {
  /** The group label itself — function, department, whatever was passed in. */
  key: string;
  size: number;
  withinTies: number;
  /** Ordered pairs inside the group: size x (size - 1). */
  withinPossible: number;
  outTies: number;
  /** Ordered pairs from this group's members to everyone else grouped. */
  outPossible: number;
  /** withinTies / withinPossible, 2dp. null when suppressed or nothing possible. */
  withinRate: number | null;
  /** outTies / outPossible, 2dp. null when suppressed or nothing possible. */
  outRate: number | null;
  /** True when the group is too small to report a rate for without exposing people. */
  suppressed: boolean;
}

/**
 * How much of each subgroup's connection stays inside it.
 *
 * A within-rate far above the out-rate is a silo; the two close together is a
 * group that works across its own boundary. Both rates are over *possible*
 * pairs, not over ties given, so a small function is not flattered by having
 * fewer people to ignore.
 *
 * Members with no group (null or '') are left out of the analysis entirely —
 * they are neither counted as a group nor as somebody else's outside world,
 * because an "Unassigned" bucket is not a subgroup and reporting one as if it
 * were invites reading a data-entry gap as a finding.
 *
 * Below `minGroupSize` (3 by default) the rates are withheld. In a cohort this
 * small and this named, the average of a two-person subgroup is two people's
 * behaviour with a decimal point on it, and either of them can work out the
 * other's half. The counts stay — they are the reason the row is visible at
 * all — but the rates that would invite the inference do not.
 */
export function subgroupCohesion(
  members: readonly { no: number; group: string | null }[],
  ties: readonly DirectedTie[],
  minGroupSize = 3,
): SubgroupTieStats[] {
  const groupOf = new Map<number, string>();
  const byGroup = new Map<string, number[]>();
  for (const m of members) {
    const key = m.group ?? '';
    if (key === '') continue;
    if (groupOf.has(m.no)) continue;
    groupOf.set(m.no, key);
    const list = byGroup.get(key);
    if (list) list.push(m.no);
    else byGroup.set(key, [m.no]);
  }

  const universe = groupOf.size;
  const seen = new Set<string>();
  const withinTies = new Map<string, number>();
  const outTies = new Map<string, number>();

  for (const t of ties) {
    if (t.from === t.to) continue;
    const from = groupOf.get(t.from);
    const to = groupOf.get(t.to);
    if (from === undefined || to === undefined) continue;
    const key = `${t.from}>${t.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const target = from === to ? withinTies : outTies;
    target.set(from, (target.get(from) ?? 0) + 1);
  }

  const stats: SubgroupTieStats[] = [];
  for (const [key, list] of byGroup) {
    const size = list.length;
    const withinPossible = size * (size - 1);
    const outPossible = size * (universe - size);
    const within = withinTies.get(key) ?? 0;
    const out = outTies.get(key) ?? 0;
    const suppressed = size < minGroupSize;
    stats.push({
      key,
      size,
      withinTies: within,
      withinPossible,
      outTies: out,
      outPossible,
      withinRate: suppressed || withinPossible === 0 ? null : round2(within / withinPossible),
      outRate: suppressed || outPossible === 0 ? null : round2(out / outPossible),
      suppressed,
    });
  }

  return stats.sort((a, b) => b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ------------------------------------------------------------------ helpers

function dedupe(nodes: readonly number[]): number[] {
  return [...new Set(nodes)];
}

function sortedOf(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
