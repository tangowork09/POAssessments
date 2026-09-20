/**
 * One wave of a Collaboration Diagnostic, read.
 *
 * The master copy asks for two readings of the same answers and this screen
 * gives both equal weight. The average says how healthy the system is; the
 * spread says how much the leaders disagree with each other, and an item where
 * half the group strongly agrees while half strongly disagrees is a finding
 * that the average on its own destroys. So every statement shows the answers
 * that produced its mean, and an item the group splits on is flagged.
 *
 * Three things here are deliberate and easy to undo by accident:
 *
 *  - The tracks start at 1, not 0. The instrument's floor is 1, and a bar
 *    starting at zero reports a third of its length as a score nobody can give.
 *  - The strips show *converted* answers, so 5 always means healthy whichever
 *    way the statement was worded. Showing raw answers would colour agreement
 *    with a problem statement as though it were good news.
 *  - A segment under the run's floor keeps its name and its count and loses its
 *    figures. Not a blank row: the facilitator needs to know the department
 *    took part.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { ErrorState, Loading } from '../ui.js';
import type { ItemStat, RunResults as Results, SectionScore } from './types.js';

/** A value's place on the instrument's own 1..5 scale. */
function pos(value: number): number {
  return ((value - 1) / 4) * 100;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'split', label: 'Split opinion' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'strength', label: 'Strengths' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];
type SortKey = 'weakest' | 'strongest' | 'spread' | 'order';

export function RunResults({ runId, wave }: { runId: string; wave?: number }) {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('weakest');
  const [tableView, setTableView] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .get<Results>(`/api/admin/collab-runs/${runId}/results${wave ? `?wave=${wave}` : ''}`)
      .then((r) => live && setData(r))
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof ApiError ? err.message : 'Could not load these results.');
      });
    return () => {
      live = false;
    };
  }, [runId, wave]);

  const statements = useMemo(() => {
    const map = new Map<number, Results['statements'][number]>();
    for (const s of data?.statements ?? []) map.set(s.no, s);
    return map;
  }, [data]);

  const ranked = useMemo(
    () => [...(data?.group.sections ?? [])].sort((a, b) => b.mean - a.mean || a.key.localeCompare(b.key)),
    [data],
  );

  const items = useMemo(() => {
    if (!data) return [];
    const attention = new Set(data.group.attention);
    const strengths = new Set(data.group.strengths);
    let list = [...data.group.items];
    if (filter === 'split') list = list.filter((i) => i.split);
    if (filter === 'attention') list = list.filter((i) => attention.has(i.no));
    if (filter === 'strength') list = list.filter((i) => strengths.has(i.no));
    const by: Record<SortKey, (a: ItemStat, b: ItemStat) => number> = {
      weakest: (a, b) => a.mean - b.mean,
      strongest: (a, b) => b.mean - a.mean,
      spread: (a, b) => (b.sd ?? 0) - (a.sd ?? 0),
      order: (a, b) => a.no - b.no,
    };
    return list.sort(by[sort]);
  }, [data, filter, sort]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Scoring this wave…" />;

  const { group, turnout } = data;
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  const markerPct = ((group.total - 24) / 96) * 100;

  const counts: Record<FilterKey, number> = {
    all: group.items.length,
    split: group.split.length,
    attention: group.attention.length,
    strength: group.strengths.length,
  };

  return (
    <>
      <header className="cd-runbar">
        <div>
          {/* The run card above names the run. Repeating it here would make the
              reader check whether the two headings are the same thing. */}
          <h2>Wave {data.wave}</h2>
          <div className="cd-runmeta">
            <span>{data.run.anonymous ? 'Anonymous responses' : 'Named responses'}</span>
            <span className="cd-sep" />
            <span>Departments under {data.minSegment} are not reported</span>
          </div>
        </div>
        <Turnout turnout={turnout} incomplete={group.incomplete} />
      </header>

      <section className="cd-sec">
        <div className="cd-sec-head">
          <h3>Where this organisation stands</h3>
          <p>
            The 24 converted scores, summed. The bands are the instrument&rsquo;s own indicative guide,
            not a cut-off.
          </p>
        </div>
        <div className="cd-panel">
          <div className="cd-index">
            <div className="cd-index-fig">
              <div className="cd-index-val num">
                {group.total}
                <small> / 120</small>
              </div>
              <div className="cd-index-sub">{group.perItem.toFixed(2)} average per statement</div>
              <div className={`cd-band cd-band-${group.band.key}`}>{group.band.name}</div>
            </div>
            <div className="cd-scale">
              <div
                className="cd-scale-track"
                role="img"
                aria-label={`Index ${group.total} of 120, in the band: ${group.band.name}`}
              >
                <span className="cd-zone-breaking" style={{ width: '24%' }} />
                <span className="cd-zone-barriers" style={{ width: '24%' }} />
                <span className="cd-zone-friction" style={{ width: '24%' }} />
                <span className="cd-zone-healthy" style={{ width: '28%' }} />
              </div>
              <div className="cd-scale-labels">
                <div style={{ width: '24%' }}>
                  <b>24–47</b>Breaking down
                </div>
                <div style={{ width: '24%' }}>
                  <b>48–71</b>Systemic barriers
                </div>
                <div style={{ width: '24%' }}>
                  <b>72–95</b>Real friction
                </div>
                <div style={{ width: '28%' }}>
                  <b>96–120</b>Healthy
                </div>
              </div>
              <div className="cd-marker" style={{ left: `${markerPct}%` }}>
                <span className="num">{group.total}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cd-sec">
        <div className="cd-sec-head">
          <h3>The six sections, strongest to weakest</h3>
          <p>
            Converted means on the instrument&rsquo;s own 1–5 scale, so each track starts at 1. The light
            bar behind a mean is the spread across respondents. A long bar means they do not agree
            with each other.
          </p>
        </div>
        <div className="cd-panel cd-ladder">
          {ranked.map((section) => (
            <SectionRow
              key={section.key}
              section={section}
              strongest={section.key === strongest?.key}
              weakest={section.key === weakest?.key}
            />
          ))}
          <div className="cd-axis">
            <div className="cd-axis-ticks">
              <b>1</b>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <b>5</b>
            </div>
          </div>
          {strongest && weakest && strongest.key !== weakest.key && (
            <div className="cd-gap">
              <div className="cd-caliper">
                <span
                  className="cd-caliper-bar"
                  style={{ left: `${pos(weakest.mean)}%`, width: `${pos(strongest.mean) - pos(weakest.mean)}%` }}
                />
                <span
                  className="cd-caliper-lab"
                  style={{ left: `${(pos(weakest.mean) + pos(strongest.mean)) / 2}%` }}
                >
                  gap {group.gap.value.toFixed(2)}
                </span>
              </div>
              <div className="cd-gap-why">strongest → weakest</div>
            </div>
          )}
        </div>
      </section>

      <section className="cd-sec">
        <div className="cd-sec-head">
          <h3>Every statement</h3>
          <p>
            Each strip is the {group.n} answers after conversion, so 5 always means healthy whichever way
            the statement was worded.
          </p>
        </div>
        <div className="cd-panel">
          <div className="cd-controls">
            <div className="cd-chips">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="cd-chip"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="cd-n">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <span className="cd-spacer" />
            <label className="cd-legend" htmlFor="cd-sort">
              Sort
              <select
                id="cd-sort"
                className="control cd-control-sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="weakest">Weakest first</option>
                <option value="strongest">Strongest first</option>
                <option value="spread">Most disagreement</option>
                <option value="order">Statement order</option>
              </select>
            </label>
            <button
              type="button"
              className="cd-chip"
              aria-pressed={tableView}
              onClick={() => setTableView((v) => !v)}
            >
              {tableView ? 'Chart view' : 'Table view'}
            </button>
          </div>
          <div className="cd-controls">
            <div className="cd-legend">
              <span>Converted answer</span>
              <span className="cd-sw">
                <i className="cd-v1" />1 unhealthy
              </span>
              <span className="cd-sw">
                <i className="cd-v2" />2
              </span>
              <span className="cd-sw">
                <i className="cd-v3" />3 neither
              </span>
              <span className="cd-sw">
                <i className="cd-v4" />4
              </span>
              <span className="cd-sw">
                <i className="cd-v5" />5 healthy
              </span>
            </div>
          </div>

          {tableView ? (
            <ItemTable items={items} statements={statements} />
          ) : (
            <div className="cd-items">
              {items.map((item) => (
                <ItemRow key={item.no} item={item} statement={statements.get(item.no)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {data.cuts.map((cut) => (
        <section className="cd-sec" key={cut.key}>
          <div className="cd-sec-head">
            <h3>By {cut.label.toLowerCase()}</h3>
            <p>
              Section means for each {cut.label.toLowerCase()}. Anything with fewer than {data.minSegment}{' '}
              respondents is not reported: at that size an average is close enough to a quotation to
              identify who said what.
            </p>
          </div>
          <div className="cd-panel cd-matrix">
            <table>
              <thead>
                <tr>
                  <th>{cut.label}</th>
                  {group.sections.map((s) => (
                    <th key={s.key}>{s.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cut.segments.map((segment) => (
                  <tr key={segment.name}>
                    <td className="cd-segname">
                      {segment.name}
                      <em>
                        {segment.n} {segment.n === 1 ? 'respondent' : 'respondents'}
                      </em>
                    </td>
                    {segment.sections ? (
                      group.sections.map((s) => {
                        const mine = segment.sections?.find((x) => x.key === s.key);
                        return (
                          <td className="cd-cell" key={s.key}>
                            <span className="cd-cellbox">
                              <span className="cd-cellbar">
                                <i style={{ width: `${pos(mine?.mean ?? 1)}%` }} />
                              </span>
                              <span className="num">{mine ? mine.mean.toFixed(1) : '—'}</span>
                            </span>
                          </td>
                        );
                      })
                    ) : (
                      <td className="cd-cell" colSpan={group.sections.length}>
                        <span className="cd-suppressed">
                          {segment.n === 0
                            ? 'Nobody from here answered.'
                            : `Not reported. Fewer than ${data.minSegment} respondents, so an average would identify individuals.`}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="cd-foot">
        <p>
          <b>Reading it.</b> Look at the average and the spread together. An item where half the leaders
          strongly agree and half strongly disagree has the same average as one everybody is lukewarm
          about, and means something entirely different. It is usually a barrier that one set of
          functions feels sharply and another cannot see.
        </p>
        <p>
          <b>Method.</b> Ten statements are scored as answered; fourteen are worded as problems and
          converted with 6 − the answer, so a 5 always means healthy. Spread is the standard deviation
          across respondents. Split opinion flags a statement where at least 30% of answers sit at each
          end of the scale.
        </p>
      </div>
    </>
  );
}

function Turnout({ turnout, incomplete }: { turnout: Results['turnout']; incomplete: number }) {
  // A run answered through one shared link has no denominator, so it reports a
  // count rather than a rate. Inventing one would mean dividing the answers by
  // themselves and calling the result a response rate.
  const seats = turnout.invited > 0 ? turnout.invited : turnout.completed;
  return (
    <div className="cd-turnout">
      <div className="cd-turnout-head">
        <b className="num">
          {turnout.completed}
          {turnout.invited > 0 && <span style={{ color: 'var(--ink-3)' }}>/{turnout.invited}</span>}
        </b>
        <span>{turnout.invited > 0 ? 'leaders answered' : 'answered'}</span>
      </div>
      <div
        className="cd-seats"
        role="img"
        aria-label={
          turnout.invited > 0
            ? `${turnout.completed} of ${turnout.invited} invited leaders have answered`
            : `${turnout.completed} leaders have answered`
        }
      >
        {Array.from({ length: Math.min(seats, 200) }, (_, i) => (
          <span key={i} className={`cd-seat${i < turnout.completed ? ' is-in' : ''}`} />
        ))}
      </div>
      <p className="cd-note">
        {turnout.invited > 0
          ? `${Math.max(0, turnout.invited - turnout.completed)} outstanding.`
          : 'Answered through a shared link, so there is no invited total to measure against.'}
        {incomplete > 0 && ` ${incomplete} unfinished ${incomplete === 1 ? 'sheet is' : 'sheets are'} left out.`}
      </p>
    </div>
  );
}

function SectionRow({
  section,
  strongest,
  weakest,
}: {
  section: SectionScore;
  strongest: boolean;
  weakest: boolean;
}) {
  const spread = section.spread ?? 0;
  const lo = Math.max(1, section.mean - spread);
  const hi = Math.min(5, section.mean + spread);
  return (
    <div className={`cd-row${strongest ? ' is-strongest' : ''}${weakest ? ' is-weakest' : ''}`}>
      <div className="cd-row-name">{section.short}</div>
      <div
        className="cd-track"
        role="img"
        aria-label={`${section.short}: mean ${section.mean.toFixed(2)} of 5${
          section.spread === null ? '' : `, spread ${section.spread.toFixed(2)}`
        }`}
      >
        <span className="cd-rail" />
        <span className="cd-tick" style={{ left: '25%' }} />
        <span className="cd-tick" style={{ left: '50%' }} />
        <span className="cd-tick" style={{ left: '75%' }} />
        {section.spread !== null && (
          <span className="cd-whisk" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
        )}
        <span className="cd-fill" style={{ width: `${pos(section.mean)}%` }} />
      </div>
      <div className="cd-row-val num">
        {section.mean.toFixed(2)}
        <em>{section.spread === null ? 'one response' : `± ${section.spread.toFixed(2)}`}</em>
      </div>
    </div>
  );
}

function ItemRow({ item, statement }: { item: ItemStat; statement?: Results['statements'][number] }) {
  const total = item.counts.reduce((t, n) => t + n, 0);
  return (
    <div className="cd-item">
      <div className="cd-item-no">{String(item.no).padStart(2, '0')}</div>
      <div>
        <p className="cd-stmt">{statement?.text ?? `Statement ${item.no}`}</p>
        <div className="cd-tags">
          {statement && <span className="cd-tag">{statement.section}</span>}
          <span className="cd-tag">
            {statement?.direction === 'reverse' ? 'Reverse scored' : 'Direct'}
          </span>
          {item.split && (
            <span className="cd-tag cd-tag-split">
              <SplitIcon />
              Split opinion
            </span>
          )}
        </div>
      </div>
      <div className="cd-dist">
        <div
          className="cd-strip"
          role="img"
          aria-label={item.counts.map((n, i) => `${n} at ${i + 1}`).join(', ')}
        >
          {item.counts.map((n, i) => {
            const share = total > 0 ? (n / total) * 100 : 0;
            return (
              <span
                key={i}
                className={`cd-v${i + 1}`}
                style={{ flex: `0 0 ${share}%` }}
                title={`${n} answered ${i + 1}`}
              >
                {n > 0 && share > 7 ? n : ''}
              </span>
            );
          })}
        </div>
        <div className="cd-striplab">
          <span>{Math.round(item.lowShare * 100)}% at 1–2</span>
          <span>{Math.round(item.highShare * 100)}% at 4–5</span>
        </div>
      </div>
      <div className="cd-figs">
        <div className="cd-figs-m num">{item.mean.toFixed(2)}</div>
        <div className="cd-figs-s">
          spread <b className="num">{item.sd === null ? '—' : item.sd.toFixed(2)}</b>
        </div>
      </div>
    </div>
  );
}

/** The table view is the accessible twin of the strips, not a lesser one. */
function ItemTable({
  items,
  statements,
}: {
  items: ItemStat[];
  statements: Map<number, Results['statements'][number]>;
}) {
  return (
    <div className="cd-matrix">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Statement</th>
            <th>Type</th>
            <th>Mean</th>
            <th>Spread</th>
            <th>1</th>
            <th>2</th>
            <th>3</th>
            <th>4</th>
            <th>5</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.no}>
              <td className="num">{item.no}</td>
              <td>{statements.get(item.no)?.text ?? ''}</td>
              <td>{statements.get(item.no)?.direction === 'reverse' ? 'R' : 'D'}</td>
              <td className="num">{item.mean.toFixed(2)}</td>
              <td className="num">{item.sd === null ? '—' : item.sd.toFixed(2)}</td>
              {item.counts.map((n, i) => (
                <td className="num" key={i}>
                  {n}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6 1.5v9M2.5 4 1 6l1.5 2M9.5 4 11 6l-1.5 2" />
    </svg>
  );
}
