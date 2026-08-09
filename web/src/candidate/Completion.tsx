/** Completion screen. Also the resting state for a completed personal link. */

import { useEffect, useMemo, useState } from 'react';
import type { CandidateSession } from '../../../src/shared/types.js';

const CONFETTI_COLOURS = ['#0BA5C8', '#FF8A24', '#2FA96B', '#FFC53D', '#087E9A'];
const CONFETTI_PIECES = 20;

export function Completion({
  session,
  token,
  reportReady,
  email,
}: {
  session: CandidateSession;
  token: string;
  reportReady: boolean;
  email: string;
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

        <div className="stage-scroll">
          <span className="eyebrow">All {session.questions.length} answered</span>
          <h2 className="display">Nice work{firstName ? `, ${firstName}` : ''}.</h2>
          <p className="lede">
            That is everything we needed. Your answers are in, and your influencing profile is being
            put together right now — written in plain language, with nothing to decode.
          </p>

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
              <h3>Your PDF report is on its way</h3>
              <p>
                {email ? (
                  <>
                    It lands at <b>{email}</b> in the next few minutes.
                  </>
                ) : (
                  'It will arrive by email in the next few minutes.'
                )}{' '}
                Nothing else is needed from you.
              </p>
            </div>
          </div>

          <dl className="done-receipt">
            <div>
              <dt>Assessment</dt>
              <dd>{session.assessment.name}</dd>
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
              <dt>Statements answered</dt>
              <dd className="num">
                {session.questions.length} of {session.questions.length}
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

        <div className="stage-pin">
          <div className="cta-row">
            {reportReady ? (
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
            You can close this page. Coming back to your link brings you right back here — it never
            expires.
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
