/**
 * Candidate chrome: a brand bar and a content well. No navigation of any kind —
 * a candidate has exactly one place to be at any moment.
 */

import type { ReactNode } from 'react';
import type { Branding } from '../../../src/shared/types.js';

export const DEFAULT_BRANDING: Branding = {
  companyName: 'Assessment',
  accentColor: '#1A4FD6',
  logoDataUrl: '',
  supportEmail: '',
};

export function LogoSlot({ branding, size = 32 }: { branding: Branding; size?: number }) {
  if (branding.logoDataUrl) {
    return (
      <img
        className="logo-img"
        src={branding.logoDataUrl}
        alt={branding.companyName}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6 }}
      />
    );
  }
  return (
    <div className="logo-slot" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(branding.companyName || 'A').trim().charAt(0).toUpperCase()}
    </div>
  );
}

export function Shell({
  branding,
  subtitle,
  children,
  narrow,
}: {
  branding: Branding;
  subtitle?: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <LogoSlot branding={branding} />
            <div className="brand-text">
              <span className="brand-name">{branding.companyName}</span>
              {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
            </div>
          </div>
          <div className="topbar-spacer" />
        </div>
      </header>
      <main className="wrap" style={narrow ? { maxWidth: 780 } : undefined}>
        {children}
      </main>
    </>
  );
}

/** Applies the tenant accent so branding reaches every accented surface. */
export function useAccent(branding: Branding): void {
  if (typeof document !== 'undefined' && branding.accentColor) {
    document.documentElement.style.setProperty('--accent', branding.accentColor);
    document.documentElement.style.setProperty('--pull', branding.accentColor);
  }
}

export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      <div className="card" style={{ padding: 40, marginTop: 48 }}>
        {children}
      </div>
    </div>
  );
}
