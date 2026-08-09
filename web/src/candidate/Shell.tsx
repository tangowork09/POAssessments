/**
 * Candidate chrome: a brand bar and a content well. No navigation of any kind —
 * a candidate has exactly one place to be at any moment.
 */

import { useEffect, type ReactNode } from 'react';
import type { Branding } from '../../../src/shared/types.js';

export const DEFAULT_BRANDING: Branding = {
  companyName: 'Assessment',
  accentColor: '#1A4FD6',
  logoDataUrl: '',
  supportEmail: '',
};

/** The Friendly Bold primary, used when no tenant accent has been set. */
const FRIENDLY_PRIMARY = '#0BA5C8';

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
  friendly,
}: {
  branding: Branding;
  subtitle?: string;
  children: ReactNode;
  narrow?: boolean;
  /**
   * Friendly Bold: the assessment flow (welcome → details → statements →
   * completion). The landing page and the report stay on the Enterprise
   * system, so the class is scoped to this wrapper rather than the document.
   */
  friendly?: boolean;
}) {
  // The Enterprise ground is grey; Friendly Bold stands on white. The body sits
  // outside the React root, so it is painted for as long as the flow is mounted.
  useEffect(() => {
    if (!friendly || typeof document === 'undefined') return;
    document.body.classList.add('fb-body');
    return () => document.body.classList.remove('fb-body');
  }, [friendly]);

  return (
    <div className={friendly ? 'fb' : undefined}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <LogoSlot branding={branding} size={friendly ? 48 : 32} />
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
    </div>
  );
}

/**
 * Applies the tenant accent so branding reaches every accented surface.
 *
 * `--accent`/`--pull` drive the Enterprise surfaces (the report). The
 * `--brand-*` set drives the Friendly Bold primary in the assessment flow: a
 * configured accent replaces the default teal, and its pressed edge, soft fill
 * and ink are derived from it so the chunky button edges stay in the family.
 */
export function useAccent(branding: Branding): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (branding.accentColor) {
    root.style.setProperty('--accent', branding.accentColor);
    root.style.setProperty('--pull', branding.accentColor);
  }

  // An untouched Branding panel still reports the Enterprise default, which is
  // not a deliberate choice — the flow keeps its own teal in that case.
  const chosen =
    branding.accentColor &&
    branding.accentColor.toUpperCase() !== DEFAULT_BRANDING.accentColor.toUpperCase()
      ? branding.accentColor
      : FRIENDLY_PRIMARY;
  const primary = parseHex(chosen) ? chosen : FRIENDLY_PRIMARY;

  root.style.setProperty('--brand-accent', primary);
  root.style.setProperty('--brand-accent-edge', shade(primary, -0.26));
  root.style.setProperty('--brand-accent-soft', shade(primary, 0.9));
  root.style.setProperty('--brand-accent-ink', shade(primary, -0.4));
}

function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Mixes towards white (amount > 0) or black (amount < 0). */
function shade(value: string, amount: number): string {
  const rgb = parseHex(value);
  if (!rgb) return value;
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  const out = rgb.map((c) => Math.round(c + (target - c) * t));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
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
