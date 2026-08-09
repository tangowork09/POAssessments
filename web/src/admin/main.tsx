/**
 * Admin console entry point. Mounted under /admin only; nothing in the
 * candidate bundle references this shell or its routes.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
        <p className="hint" style={{ marginTop: 64 }}>
          Loading…
        </p>
      </div>
    );
  }

  if (!user) return <Login onSignedIn={setUser} />;

  return (
    <AdminShell user={user} onSignedOut={() => setUser(null)}>
      <Routes>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/assessments" element={<Assessments />} />
        <Route path="/admin/candidates" element={<Candidates />} />
        <Route path="/admin/invites" element={<Invites />} />
        <Route path="/admin/links" element={<AssessmentLinks />} />
        <Route path="/admin/branding" element={<BrandingPanel />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
