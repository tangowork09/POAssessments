/**
 * Cohort reports on screen: the facilitator's group report, and one leader's
 * peer-feedback report.
 *
 * Both come from `/api/report/cohort/:token` and both render from the same
 * payload the PDF is built from, so the page and the download can never
 * disagree about a number.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { Centered, DEFAULT_BRANDING, LogoSlot, Shell, useAccent } from './Shell.js';
import { ReportSkeleton } from './Skeleton.js';
import { SOCIO_MAX_ANSWER } from '../../../src/shared/socio.js';
import {
  SOCIO_QUADRANT_FOR_MEMBER,
  powerKindForMember,
  type SocioQuadrant,
  type SocioStanding,
} from '../../../src/shared/socio-scoring.js';
import type {
  CohortReportPayload,
  SocioGroupReportPayload,
  SocioMemberReportPayload,
} from '../../../src/shared/types.js';

export function CohortReportPage() {
  const { token = '' } = useParams();
  const [report, setReport] = useState<CohortReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CohortReportPayload>(`/api/report/cohort/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'This report could not be opened.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const branding = report?.branding ?? DEFAULT_BRANDING;
  useAccent(branding);

  if (error) {
    return (
      <Shell branding={DEFAULT_BRANDING}>
        <Centered>
          <p className="eyebrow">Report unavailable</p>
          <h1 className="display" style={{ fontSize: 24, marginTop: 10 }}>
            {error}
          </h1>
          <p className="hint" style={{ marginTop: 14 }}>
            Report links are re-issued whenever a report is sent again, so an older link stops working.
            Ask whoever sent it to you for the current one.
          </p>
        </Centered>
      </Shell>
    );
  }

  if (!report) {
    return (
      <Shell branding={DEFAULT_BRANDING} friendly>
        <ReportSkeleton />
      </Shell>
    );
  }

  return (
    <Shell branding={branding} subtitle={report.assessmentName}>
      <div className="co-report">
        <header className="co-head">
          <LogoSlot branding={branding} size={48} />
          <span className="eyebrow">
            {report.kind === 'socio_group' ? 'Group report' : 'Peer feedback report'}
          </span>
          <h1 className="display">
            {report.kind === 'socio_group' ? report.cohortName : report.member.name}
          </h1>
          <p className="lede">
            {report.kind === 'socio_group'
              ? report.organisation || report.assessmentName
              : `${report.cohortName}${report.organisation ? ` · ${report.organisation}` : ''}`}
          </p>
          <a
            className="btn btn-secondary btn-sm"
            href={`/api/report/cohort/${encodeURIComponent(token)}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Download the PDF
          </a>
        </header>

        <section className="co-card">
          <h2>At a glance</h2>
          <p className="co-summary">{report.summary}</p>
        </section>

        {report.kind === 'socio_group' ? <GroupBody report={report} /> : <MemberBody report={report} />}

        <section className="co-card co-fine">
          <h2>How to read this</h2>
          <p>{report.confidentiality}</p>
          <p>
            This is not a performance review. These statements describe how a working relationship feels
            from the other side of it, and they are shaped by role and by how much contact two people
            have. Treat every figure as the opening of a conversation rather than the conclusion of one.
          </p>
        </section>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------- group report

function GroupBody({ report }: { report: SocioGroupReportPayload }) {
  const g = report.group;

  return (
    <>
      <section className="co-card">
        <h2>Coverage</h2>
        <div className="co-stats">
          <Stat label="Responses" value={`${g.respondents} of ${g.rosterSize}`} note={pct(g.responseRate)} />
          <Stat label="Ratings given" value={String(g.ratingsGiven)} note={`of ${g.possiblePairs} possible`} />
          <Stat label="Working contact" value={pct(g.acquaintance)} note="of pairs rated" />
          <Stat label="Rater floor" value={String(g.minRaters)} note="for an individual profile" />
        </div>
      </section>

      <section className="co-card">
        <h2>The four networks</h2>
        <p className="hint">
          A tie is drawn where a colleague rated someone {g.tieThreshold} or above. Density is over rated
          pairs, not over the whole roster — blanks are not counted as low scores.
        </p>

        {g.networks.map((net) => (
          <div className="co-net" key={net.blockKey}>
            <div className="co-net-head" style={{ borderColor: net.color }}>
              <h3>{net.name}</h3>
              <div className="co-net-stats">
                <span>
                  <b>{pct(net.density)}</b> density
                </span>
                <span>
                  <b>{pct(net.reciprocity)}</b> reciprocity
                </span>
                <span>
                  <b>{net.concentration === null ? '—' : net.concentration.toFixed(2)}</b> concentration
                </span>
              </div>
            </div>
            <ul className="co-bars">
              {net.ranked
                .filter((r) => r.tieRate !== null)
                .slice(0, 8)
                .map((r) => (
                  <li key={r.memberNo}>
                    <span className="co-bar-name">{r.name}</span>
                    <span className="co-track">
                      <span
                        className="co-fill"
                        style={{ width: `${(r.tieRate ?? 0) * 100}%`, background: net.color }}
                      />
                    </span>
                    <span className="co-val">
                      {r.ties} · {pct(r.tieRate)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="co-card">
        <h2>Authority and trust</h2>
        <p className="hint">
          Power-over minus trust. Positive means colleagues adjust to that person more readily than they
          rely on them; negative means the reverse. Neither is a fault.
        </p>
        <div className="co-split">
          <GapList title="Complied with, more than relied on" entries={g.authorityWithoutTrust} tone="warn" />
          <GapList title="Relied on, more than deferred to" entries={g.trustWithoutAuthority} tone="good" />
        </div>
      </section>

      <section className="co-card">
        <h2>Where more is wanted</h2>
        <p className="hint">
          The one statement where a high score is a request rather than a strength. Most often a load
          problem or an unowned queue, not a verdict on the person named.
        </p>
        {g.supportGaps.length === 0 ? (
          <p className="hint">No reportable support gaps at this coverage.</p>
        ) : (
          <ul className="co-bars">
            {g.supportGaps.map((s) => (
              <li key={s.memberNo}>
                <span className="co-bar-name">{s.name}</span>
                <span className="co-track">
                  <span
                    className="co-fill"
                    style={{ width: `${(s.wanters / Math.max(1, s.n)) * 100}%`, background: '#B54708' }}
                  />
                </span>
                <span className="co-val">
                  {s.wanters} of {s.n} asked
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {g.functions.length > 1 ? (
        <section className="co-card">
          <h2>Seams between functions</h2>
          <p className="hint">Mean trust, from the row’s function to the column’s. A blank is itself a seam.</p>
          <div className="co-scroll">
            <table className="co-heat">
              <thead>
                <tr>
                  <th />
                  {g.functions.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.functions.map((from) => (
                  <tr key={from}>
                    <th scope="row">{from}</th>
                    {g.functions.map((to) => {
                      const cell = g.functionMatrix.find((c) => c.from === from && c.to === to);
                      const v = cell?.trust ?? null;
                      return (
                        <td
                          key={to}
                          style={
                            v === null
                              ? undefined
                              : {
                                  background: `color-mix(in srgb, var(--accent) ${Math.round(
                                    ((v - 1) / (SOCIO_MAX_ANSWER - 1)) * 100,
                                  )}%, white)`,
                                }
                          }
                          title={cell ? `${cell.n} rated pairs` : undefined}
                        >
                          {v === null ? '—' : v.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="co-card">
        <h2>What was withheld</h2>
        {g.underCovered.length > 0 ? (
          <p>
            {g.underCovered.length === 1 ? 'One member was' : `${g.underCovered.length} members were`} rated
            by fewer than {g.minRaters} colleagues, so no individual profile was produced:{' '}
            {g.underCovered.map((m) => `${m.name} (${m.coverage})`).join(', ')}.
          </p>
        ) : (
          <p>Every member was rated by at least {g.minRaters} colleagues, so no profile was withheld.</p>
        )}
        {g.isolates.length > 0 ? (
          <p>
            {g.isolates.map((m) => m.name).join(', ')} {g.isolates.length === 1 ? 'was' : 'were'} rated, but
            by nobody at or above the tie threshold on any of the four groups. That is a finding about
            connection, not a low score.
          </p>
        ) : null}
      </section>
    </>
  );
}

// ------------------------------------------------------------ member report

function MemberBody({ report }: { report: SocioMemberReportPayload }) {
  if (report.suppressed) {
    return (
      <section className="co-card co-fine">
        <h2>No profile in this report</h2>
        <p>
          You were rated by {report.member.coverage} of {report.member.possibleRaters} colleagues, below the{' '}
          {report.groupContext.minRaters}-rater floor this group set. Reporting an average of one or two
          responses in a named group of this size would identify who gave them, which is the one thing
          every participant was promised would not happen.
        </p>
        <p>Nothing has gone wrong, and nothing is being kept from you — the numbers do not exist in a reportable form.</p>
      </section>
    );
  }

  const gap = report.member.supportGap;

  return (
    <>
      {report.standing ? <StandingCard standing={report.standing} /> : null}
      <section className="co-card">
        <h2>How colleagues describe working with you</h2>
        <p className="hint">
          Each bar is an average across the {report.member.coverage} colleagues who had a basis to judge.
          The tick shows where the rest of the group sits.
        </p>
        <ul className="co-bars co-bars-lg">
          {report.context.map((c) => (
            <li key={c.blockKey}>
              <span className="co-bar-name">
                {c.name}
                {c.delta !== null ? (
                  <em className={c.delta < 0 ? 'co-delta is-down' : 'co-delta'}>{signed(c.delta)} vs group</em>
                ) : null}
              </span>
              <span className="co-track">
                <span
                  className="co-fill"
                  style={{
                    width: `${((c.memberMean ?? 0) / SOCIO_MAX_ANSWER) * 100}%`,
                    background: c.color,
                  }}
                />
                {c.cohortMean !== null ? (
                  <span
                    className="co-tick"
                    style={{ left: `${(c.cohortMean / SOCIO_MAX_ANSWER) * 100}%` }}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <span className="co-val">{c.memberMean === null ? '—' : c.memberMean.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="co-card">
        <h2>Support asked for</h2>
        <p>
          {gap.mean === null
            ? 'No colleague answered the support statement about you, so there is nothing to report here.'
            : `Colleagues rated “I would like more support or cooperation from this person than I currently get” at ${gap.mean.toFixed(
                2,
              )} of ${SOCIO_MAX_ANSWER} across ${gap.n} ${gap.n === 1 ? 'rater' : 'raters'}. This is the one statement where a high number is a request rather than a strength.`}
        </p>
      </section>

      <section className="co-card">
        <h2>Statement by statement</h2>
        <ul className="co-bars">
          {report.member.items.map((item) => {
            const info = report.items.find((i) => i.no === item.itemNo);
            const color =
              report.context.find((c) => c.blockKey === item.blockKey)?.color ?? '#B54708';
            return (
              <li key={item.itemNo}>
                <span className="co-bar-name" title={info?.text}>
                  {item.short}
                </span>
                <span className="co-track">
                  <span
                    className="co-fill"
                    style={{ width: `${((item.mean ?? 0) / SOCIO_MAX_ANSWER) * 100}%`, background: color }}
                  />
                </span>
                <span className="co-val">
                  {item.mean === null ? '—' : item.mean.toFixed(2)} ({item.n})
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="co-card">
        <h2>How you rated others</h2>
        <p>
          {report.member.given.outDegree === 0
            ? 'You did not rate any colleagues, so there is nothing to compare here. That does not affect the figures above, which come entirely from what others said.'
            : `You rated ${report.member.given.outDegree} ${
                report.member.given.outDegree === 1 ? 'colleague' : 'colleagues'
              }, averaging ${report.member.given.mean?.toFixed(2) ?? '—'} of ${SOCIO_MAX_ANSWER}${
                report.member.given.versusCohort === null
                  ? '.'
                  : ` — ${signed(report.member.given.versusCohort)} against the group's own average.`
              } This says something about how you use a rating scale, not about how accurate you are.`}
        </p>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ pieces

/** The map's four corners, laid out as the guide draws them: trust up, power right. */
const QUADRANT_GRID: SocioQuadrant[] = ['underused', 'anchor', 'peripheral', 'watch'];

/**
 * Where the person sits on the Power × Trust map, for a coaching conversation.
 * Only ever rendered when the facilitator has sharing on — the payload carries
 * no standing otherwise.
 */
function StandingCard({ standing }: { standing: SocioStanding }) {
  const mine = SOCIO_QUADRANT_FOR_MEMBER[standing.quadrant];
  const kind = powerKindForMember(standing.powerKind);
  return (
    <section className="co-card">
      <h2>Where you sit on the Power × Trust map</h2>
      <p className="hint">
        Trust counts the colleagues who rely on you; power counts those who seek you out or follow your lead.
        Each is split at the middle of this group, so the corner describes you relative to these colleagues —
        not against any fixed standard.
      </p>
      <div className="co-quad-wrap">
        <div className="co-quad" role="img" aria-label={`Your corner: ${mine.name}`}>
          <span className="co-quad-axis co-quad-y">More trusted →</span>
          {QUADRANT_GRID.map((q) => (
            <div key={q} className={`co-quad-cell${q === standing.quadrant ? ' is-mine' : ''}`}>
              <b>{SOCIO_QUADRANT_FOR_MEMBER[q].name}</b>
              <small>{SOCIO_QUADRANT_FOR_MEMBER[q].gloss}</small>
            </div>
          ))}
          <span className="co-quad-axis co-quad-x">More influential →</span>
        </div>
        <div className="co-quad-text">
          <p className="co-quad-name">
            {mine.name}
            <span>{mine.gloss}</span>
          </p>
          <p>{mine.reading}</p>
          <p className="co-quad-kind">
            <b>Kind of power: {kind.label}.</b> {kind.reading}
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="co-stat">
      <span className="co-stat-label">{label}</span>
      <span className="co-stat-value">{value}</span>
      <span className="co-stat-note">{note}</span>
    </div>
  );
}

function GapList({
  title,
  entries,
  tone,
}: {
  title: string;
  entries: { memberNo: number; name: string; gap: number }[];
  tone: 'warn' | 'good';
}) {
  return (
    <div className={`co-gaps is-${tone}`}>
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="hint">None at this threshold.</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.memberNo}>
              <span>{e.name}</span>
              <b>{signed(e.gap)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}
