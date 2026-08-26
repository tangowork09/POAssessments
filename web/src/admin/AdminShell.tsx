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
  { to: '/admin/cohorts', label: 'Cohorts', icon: IconGroup },
  { to: '/admin/candidates', label: 'Candidates', icon: IconPeople },
  { to: '/admin/invites', label: 'Invites', icon: IconSend },
  { to: '/admin/links', label: 'Assessment Link', icon: IconLink },
  // Names people and holds previously-issued tokens, so it is absent rather
  // than merely disabled for an ordinary admin.
  { to: '/admin/activity', label: 'Activity', icon: IconLog, superadminOnly: true },
  // Branding is hidden for now at the client's request — the identity is fixed
  // to PO Assessments and the panel only invites accidental changes to what
  // every candidate, report and email carries. The route itself still works,
  // so restoring this one line brings it back with nothing else to change.
  // { to: '/admin/branding', label: 'Branding', icon: IconBrush, superadminOnly: true },
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
  // Desktop rail state. Sticky per browser: an operator who prefers the thin
  // rail gets it back on every visit, and localStorage failing (private mode)
  // just means the default.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('admin.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const navigate = useNavigate();

  function toggleCollapsed(): void {
    setCollapsed((v) => {
      try {
        localStorage.setItem('admin.sidebar', v ? 'expanded' : 'collapsed');
      } catch {
        /* the preference simply does not stick */
      }
      return !v;
    });
  }

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

      <div className={`admin-shell${collapsed ? ' is-collapsed' : ''}`}>
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
            {/* Desktop only. Collapsed, the rail keeps every destination one
                click away as an icon; labels come back with a second click.
                The narrow-screen "Menu" disclosure above is untouched. */}
            <button
              className="side-collapse"
              type="button"
              onClick={toggleCollapsed}
              aria-pressed={collapsed}
              title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            >
              <IconRail flipped={collapsed} />
              <span className="side-collapse-label">Collapse</span>
            </button>

            <p className="side-label">Manage</p>
            <nav className="side-nav" aria-label="Console sections">
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className="side-item"
                  onClick={() => setOpen(false)}
                  title={collapsed ? label : undefined}
                >
                  <Icon />
                  <span className="side-item-label">{label}</span>
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

            <button
              className="side-item side-item-full"
              type="button"
              onClick={signOut}
              title={collapsed ? 'Sign out' : undefined}
            >
              <IconExit />
              <span className="side-item-label">Sign out</span>
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
/** A ring of people rather than a pair: a cohort is a whole group at once. */
function IconGroup() {
  return (
    <svg width="15" height="15" {...svg}>
      <circle cx="7.5" cy="4" r="1.9" />
      <circle cx="3.4" cy="10.6" r="1.9" />
      <circle cx="11.6" cy="10.6" r="1.9" />
      <path d="M6.3 5.6L4.6 9M8.7 5.6l1.7 3.4M5.3 11.4h4.4" />
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
function IconLog(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" />
      <path d="M8 10h8M8 14h8M8 18h5" strokeLinecap="round" />
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
function IconExit() {
  return (
    <svg width="15" height="15" {...svg}>
      <path d="M6 2.5H3.5v11H6" />
      <path d="M9 5.5l2.5 2.5L9 10.5M11.5 8h-6" />
    </svg>
  );
}
/** The rail toggle: a door with the panel on the side being shown or hidden. */
function IconRail({ flipped }: { flipped: boolean }) {
  return (
    <svg width="15" height="15" {...svg} style={flipped ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6 2.5v11" />
      <path d="M11.2 6.2L9.4 8l1.8 1.8" />
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
