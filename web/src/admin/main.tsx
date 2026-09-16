/**
 * Admin console entry point. Mounted under /admin only; nothing in the
 * candidate bundle references this shell or its routes.
 */

import { StrictMode, useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import '../styles/base.css';
import '../styles/admin.css';
import { api } from '../lib/api.js';
import { Login } from './Login.js';
import { AdminShell } from './AdminShell.js';
import { Dashboard } from './Dashboard.js';
import { Assessments } from './Assessments.js';
import { Cohorts } from './Cohorts.js';
import { Candidates } from './Candidates.js';
import { Invites } from './Invites.js';
import { AssessmentLinks } from './AssessmentLinks.js';
import { Activity } from './Activity.js';
import { BrandingPanel } from './BrandingPanel.js';
import { Head } from './ui.js';
import type { AdminUser } from '../../../src/shared/types.js';
import { canAccess, landingPath, type AdminArea } from '../../../src/shared/roles.js';

function App() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .get<{ user: AdminUser }>('/api/admin/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <div className="wrap">
        <p className="hint mt-7" role="status">
          Loading the console…
        </p>
      </div>
    );
  }

  if (!user) return <Login onSignedIn={setUser} />;

  const role = user.role;
  const home = landingPath(role);

  /**
   * The server already answers 403 on every one of these. This second gate
   * exists so an administrator who types the URL gets a plain explanation
   * instead of a panel that fails on load.
   *
   * A role with no access to an area it has no nav item for — a cohort
   * administrator and the dashboard, say — is sent home rather than shown the
   * explanation: it was never offered, so refusing it reads as a fault.
   */
  function gate(area: AdminArea, panel: ReactElement): ReactElement {
    if (canAccess(role, area)) return panel;
    return canAccess(role, 'dashboard') ? <Restricted area={area} /> : <Navigate to={home} replace />;
  }

  return (
    <AdminShell user={user} onSignedOut={() => setUser(null)}>
      <Routes>
        <Route path="/admin" element={gate('dashboard', <Dashboard />)} />
        <Route path="/admin/assessments" element={gate('assessments', <Assessments />)} />
        <Route path="/admin/cohorts" element={gate('cohorts', <Cohorts />)} />
        <Route path="/admin/candidates" element={gate('candidates', <Candidates />)} />
        <Route path="/admin/invites" element={gate('invites', <Invites />)} />
        <Route path="/admin/links" element={gate('links', <AssessmentLinks />)} />
        <Route path="/admin/activity" element={gate('activity', <Activity />)} />
        <Route path="/admin/branding" element={gate('branding', <BrandingPanel />)} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </AdminShell>
  );
}

/** Dignified, specific, and offers the way forward rather than a dead end. */
function Restricted({ area }: { area: AdminArea }) {
  const { title, reason } = RESTRICTED[area] ?? {
    title: 'Restricted',
    reason: 'This panel belongs to the account that owns the deployment.',
  };
  return (
    <>
      <Head title={title} />
      <section className="card restricted-card">
        <b>Not available for your account</b>
        <p>
          {reason} Ask a super admin to make the change, or to raise your account to super admin.
        </p>
        <Link className="btn btn-secondary btn-sm" to="/admin">
          Back to the dashboard
        </Link>
      </section>
    </>
  );
}

/** Why each restricted panel is restricted, said plainly. */
const RESTRICTED: Partial<Record<AdminArea, { title: string; reason: string }>> = {
  branding: {
    title: 'Branding',
    reason:
      'Branding changes the candidate experience, the PDF report and every outbound email, so only a super admin can edit it.',
  },
  activity: {
    title: 'Activity',
    reason:
      'The activity log names people and holds previously-issued links, so only a super admin can read it.',
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
