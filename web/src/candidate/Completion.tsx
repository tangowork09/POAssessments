/** Completion screen. Also the resting state for a completed personal link. */

import { useEffect, useMemo, useState } from 'react';
import type { CandidateCohort, CandidateSession } from '../../../src/shared/types.js';

const CONFETTI_COLOURS = ['#0BA5C8', '#FF8A24', '#2FA96B', '#FFC53D', '#087E9A'];
const CONFETTI_PIECES = 20;

export function Completion({
  session,
  token,
  reportReady,
  email,
  cohort,
  ratedCount,
}: {
  session: CandidateSession;
  token: string;
  reportReady: boolean;
  email: string;
  /** Set for a cohort instrument, where nothing is scored on submission. */
  cohort: CandidateCohort | null;
  /** Cohort instruments only: colleagues this respondent actually rated. */
  ratedCount: number;
}) {
  const details = session.response?.details;
  const completedAt = session.response?.completedAt;
  const firstName = details?.firstName?.trim();

  // A one-shot burst of CSS-animated paper. Decorative only: it is hidden from
  // assistive technology and never built at all when motion is not wanted.
  const pieces = useMemo(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return [];
    }
    return Array.from({ length: CONFETTI_PIECES }, (_, i) => ({
      left: `${6 + i * 4.4}%`,
      background: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]!,
      dx: `${Math.round(Math.random() * 160 - 80)}px`,
      rot: `${Math.round(Math.random() * 720 - 360)}deg`,
      delay: `${i * 26}ms`,
    }));
  }, []);

  // The burst plays once and then takes itself out of the tree.
  const [bursting, setBursting] = useState(true);
  useEffect(() => {
    if (pieces.length === 0) return;
    const t = setTimeout(() => setBursting(false), 2600);
    return () => clearTimeout(t);
  }, [pieces.length]);

  return (
    <div className="stage">
      <div className="done rise">
        <div className="confetti" aria-hidden="true">
          {(bursting ? pieces : []).map((p, i) => (
            <span
              key={i}
              className="cf"
              style={
                {
                  left: p.left,
                  background: p.background,
                  animationDelay: p.delay,
                  '--dx': p.dx,
                  '--rot': p.rot,
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        <div className="seal" aria-hidden="true">
          <svg
            width="52"
            height="52"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12.5l5.2 5.2L20 7" />
          </svg>
        </div>

        {/* Two boxes, as on the begin screen: from 900px wide the message and
            the supporting detail sit side by side rather than stacking past
            the fold. */}
        <div className="stage-scroll">
          <div className="done-copy">
            <span className="eyebrow">
              {cohort
                ? `${ratedCount} ${ratedCount === 1 ? 'colleague' : 'colleagues'} rated`
                : `All ${session.questions.length} answered`}
            </span>
            <h2 className="display">
              {cohort ? 'Thank you' : 'Nice work'}
              {firstName ? `, ${firstName}` : ''}.
            </h2>
            <p className="lede">
              {cohort
                ? 'That is everything we needed. Nothing you entered is shown to anyone else in the group, and nothing is reported as who said what about whom.'
                : 'That is everything we needed. Your answers are in, and your profile is being put together right now — written in plain language, with nothing to decode.'}
            </p>
          </div>

          <div className="done-detail">
            {/* For a cohort the promise of a personal report is the facilitator's
                to make, not the platform's. Unless they turned sharing on for
                this cohort, nothing here mentions a report, a PDF or an email —
                the respondent is thanked and that is the whole message. */}
            {cohort && !cohort.shareReports ? null : (
            <div className="mailrow">
              <div className="icon" aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18v12H3z" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
              </div>
              <div>
                {/* A cohort is scored across every response at once, so there is
                    nothing to promise "in the next few minutes" — saying so
                    would have people refreshing an empty page for days. */}
                <h3>{cohort ? 'Your own feedback comes later' : 'Your PDF report is on its way'}</h3>
                <p>
                  {cohort ? (
                    <>
                      This exercise is read across the whole group, so nothing is produced until everyone
                      has had their turn. When your facilitator closes it,{' '}
                      {email ? (
                        <>
                          a summary of how colleagues experience working with you is sent to <b>{email}</b>.
                        </>
                      ) : (
                        'a summary of how colleagues experience working with you is sent to you by email.'
                      )}
                    </>
                  ) : (
                    <>
                      {email ? (
                        <>
                          It lands at <b>{email}</b> in the next few minutes.
                        </>
                      ) : (
                        'It will arrive by email in the next few minutes.'
                      )}{' '}
                      Nothing else is needed from you.
                    </>
                  )}
                </p>
              </div>
            </div>
            )}

            <dl className="done-receipt">
              <div>
                <dt>{cohort ? 'Group' : 'Assessment'}</dt>
                <dd>{cohort ? cohort.name : session.assessment.name}</dd>
              </div>
              {details ? (
                <div>
                  <dt>Completed by</dt>
                  <dd>
                    {details.firstName} {details.lastName}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{cohort ? 'Colleagues rated' : 'Statements answered'}</dt>
                <dd className="num">
                  {cohort
                    ? `${ratedCount} of ${
                        cohort.allowedTargetIds
                          ? cohort.allowedTargetIds.length
                          : Math.max(0, cohort.roster.length - 1)
                      }`
                    : `${session.questions.length} of ${session.questions.length}`}
                </dd>
              </div>
              {completedAt ? (
                <div>
                  <dt>Submitted</dt>
                  <dd>{formatDate(completedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>

        <div className="stage-pin">
          <div className="cta-row">
            {cohort ? null : reportReady ? (
              <a
                className="btn btn-primary btn-lg btn-block"
                href={`/t/${encodeURIComponent(token)}/report`}
              >
                View my report now
              </a>
            ) : (
              <button
                className="btn btn-ghost btn-lg btn-block"
                onClick={() => window.location.reload()}
              >
                Check whether my report is ready
              </button>
            )}
          </div>

          <p className="fineprint">
            {cohort
              ? 'You can close this page. Your ratings are locked in and cannot be changed from here — if something needs correcting, ask your facilitator.'
              : 'You can close this page. Coming back to your link brings you right back here — it never expires.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
