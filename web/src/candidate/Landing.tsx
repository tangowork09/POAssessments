/**
 * The root page. Deliberately minimal and neutral: it names the platform and
 * tells a visitor to use their personal link. It exposes no assessment, no
 * candidate data and — by design — no route into the admin console.
 */

import { DEFAULT_BRANDING, Shell } from './Shell.js';

export function Landing({ notFound }: { notFound?: boolean }) {
  return (
    <Shell branding={DEFAULT_BRANDING} narrow>
      <div className="card welcome-card" style={{ marginTop: 40 }}>
        <p className="eyebrow">{notFound ? 'Page not found' : 'Assessments'}</p>
        <h1 className="display" style={{ fontSize: 30, marginTop: 12 }}>
          {notFound ? 'That page does not exist' : 'Please use your personal assessment link'}
        </h1>
        <p className="welcome-lede">
          Assessments here are opened from the link in your invitation email. It is personal to you, it
          does not expire, and it will return you to exactly where you left off.
        </p>
        <p className="hint" style={{ marginTop: 24 }}>
          If you cannot find your invitation, ask whoever invited you to send it again.
        </p>
      </div>
    </Shell>
  );
}
