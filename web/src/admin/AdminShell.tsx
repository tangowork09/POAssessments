/** Sidebar console chrome. */

import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { RolePill } from './ui.js';
import type { AdminUser } from '../../../src/shared/types.js';

interface NavItem {
  to: string;
  label: string;
  icon: () => ReactNode;
  end?: boolean;
  /** Present when the item is restricted to one role. */
  superadminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: IconGrid, end: true },
  { to: '/admin/assessments', label: 'Assessments', icon: IconDoc },
  { to: '/admin/candidates', label: 'Candidates', icon: IconPeople },
  { to: '/admin/invites', label: 'Invites', icon: IconSend },
  { to: '/admin/links', label: 'Assessment Link', icon: IconLink },
  { to: '/admin/branding', label: 'Branding', icon: IconBrush, superadminOnly: true },
];

export function AdminShell({
  user,
  onSignedOut,
  children,
}: {
  user: AdminUser;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Branding writes settings that reach every candidate, report and email, so
  // the nav item is not merely disabled for an ordinary admin — it is absent.
  const items = NAV.filter((item) => !item.superadminOnly || user.role === 'superadmin');

  async function signOut(): Promise<void> {
    await api.post('/api/admin/logout');
    onSignedOut();
    navigate('/admin');
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="logo-slot" aria-hidden="true">
              A
            </div>
            <div className="brand-text">
              <span className="brand-name">Admin console</span>
              <span className="brand-sub">Assessment Platform</span>
            </div>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-meta">
            <RolePill role={user.role} />
            <span className="topbar-email">{user.email}</span>
            <span className="avatar" aria-hidden="true">
              {initials(user.name || user.email)}
            </span>
          </div>
        </div>
      </header>

      <div className="admin-shell">
        <aside className="sidebar">
          <button
            className="side-toggle"
            aria-expanded={open}
            aria-controls="admin-nav"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            Menu
            <IconChevron />
          </button>

          <div className={`side-body${open ? ' is-open' : ''}`} id="admin-nav">
            <p className="side-label">Manage</p>
            <nav className="side-nav" aria-label="Console sections">
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="side-item" onClick={() => setOpen(false)}>
                  <Icon />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="side-card">
              <b>Signed in</b>
              <span className="side-card-email">{user.email}</span>
              <span className="side-card-role">
                <RolePill role={user.role} />
              </span>
            </div>

            <button className="side-item side-item-full" type="button" onClick={signOut}>
              <IconExit />
              Sign out
            </button>
          </div>
        </aside>

        <main className="admin-main">{children}</main>
      </div>
    </>
  );
}

function initials(value: string): string {
  const parts = value.split(/[@\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'A') + (parts[1]?.[0] ?? '')).toUpperCase();
}

const svg = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, viewBox: '0 0 16 16' } as const;

function IconGrid() {
  return (
    <svg width="15" height="15" {...svg}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg width="15" height="15" {...svg}>
      <path d="M3.5 2.5h6l3 3v8h-9z" />
      <path d="M5.5 8h5M5.5 10.5h3" />
    </svg>
  );
}
function IconPeople() {
  return (
    <svg width="15" height="15" {...svg}>
      <circle cx="6" cy="6" r="2.3" />
      <path d="M2 13.5c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" />
      <path d="M11 5.2a2 2 0 010 3.6M11.6 13.5c0-1.6-.6-2.7-1.6-3.3" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg width="15" height="15" {...svg}>
      <path d="M13.5 2.5L7 9M13.5 2.5l-4 11-2.5-4.5L2.5 6.5z" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg width="15" height="15" {...svg}>
      <path d="M6.5 9.5a2.8 2.8 0 000 0l2-2a2.8 2.8 0 114 4l-1 1" />
      <path d="M9.5 6.5a2.8 2.8 0 000 0l-2 2a2.8 2.8 0 11-4-4l1-1" />
    </svg>
  );
}
function IconBrush() {
  return (
    <svg width="15" height="15" {...svg}>
      <path d="M11 2.5l2.5 2.5-6 6-2.5-2.5z" />
      <path d="M5 8.5c-1.5.6-2 2-2 5 3 0 4.4-.5 5-2" />
    </svg>
  );
}
function IconExit() {
  return (
    <svg width="15" height="15" {...svg}>
      <path d="M6 2.5H3.5v11H6" />
      <path d="M9 5.5l2.5 2.5L9 10.5M11.5 8h-6" />
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width="14" height="14" {...svg}>
      <path d="M4 6.5l4 3.5 4-3.5" />
    </svg>
  );
}
