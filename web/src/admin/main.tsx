/**
 * Admin console entry point. Mounted under /admin only; nothing in the
 * candidate bundle references this shell or its routes.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import '../styles/base.css';
import '../styles/admin.css';
import { api } from '../lib/api.js';
import { Login } from './Login.js';
import { AdminShell } from './AdminShell.js';
import { Dashboard } from './Dashboard.js';
import { Assessments } from './Assessments.js';
import { Candidates } from './Candidates.js';
import { Invites } from './Invites.js';
import { AssessmentLinks } from './AssessmentLinks.js';
import { BrandingPanel } from './BrandingPanel.js';
import { Head } from './ui.js';
import type { AdminUser } from '../../../src/shared/types.js';

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

  const isSuperadmin = user.role === 'superadmin';

  return (
    <AdminShell user={user} onSignedOut={() => setUser(null)}>
      <Routes>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/assessments" element={<Assessments />} />
        <Route path="/admin/candidates" element={<Candidates />} />
        <Route path="/admin/invites" element={<Invites />} />
        <Route path="/admin/links" element={<AssessmentLinks />} />
        {/*
          The server already answers 403 here. This second gate exists so a
          non-superadmin who types the URL gets a plain explanation instead of
          a panel that fails on load.
        */}
        <Route path="/admin/branding" element={isSuperadmin ? <BrandingPanel /> : <Restricted />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminShell>
  );
}

/** Dignified, specific, and offers the way forward rather than a dead end. */
function Restricted() {
  return (
    <>
      <Head title="Branding" />
      <section className="card restricted-card">
        <b>Not available for your account</b>
        <p>
          Branding changes the candidate experience, the PDF report and every outbound email, so only a super
          admin can edit it. Ask one of them to make the change, or to raise your account to super admin.
        </p>
        <Link className="btn btn-secondary btn-sm" to="/admin">
          Back to the dashboard
        </Link>
      </section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
