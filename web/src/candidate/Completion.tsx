/** Completion screen. Also the resting state for a completed personal link. */

import type { CandidateSession } from '../../../src/shared/types.js';

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

  return (
    <div className="done-wrap">
      <div className="card done-card">
        <div className="done-mark">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h2 className="display">Thank you — you are finished</h2>
        <p>
          Your answers have been submitted and your report is being prepared.
          {email ? (
            <>
              {' '}
              A copy is on its way to <b>{email}</b>.
            </>
          ) : null}
        </p>

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

        <div className="done-actions">
          {reportReady ? (
            <a className="btn btn-primary btn-lg" href={`/t/${encodeURIComponent(token)}/report`}>
              View my report
            </a>
          ) : (
            <button className="btn btn-secondary btn-lg" onClick={() => window.location.reload()}>
              Check whether my report is ready
            </button>
          )}
        </div>

        <p className="hint" style={{ marginTop: 20 }}>
          You can close this page. Returning to your link at any time will bring you back here — it does
          not expire.
        </p>
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
