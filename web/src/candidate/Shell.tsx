/**
 * Candidate chrome: a brand bar and a content well. No navigation of any kind —
 * a candidate has exactly one place to be at any moment.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { BRAND_ACCENT, BRAND_COMPANY_NAME } from '../../../src/shared/brand.js';
import type { Branding } from '../../../src/shared/types.js';

/**
 * What the shell paints before the session — and with it the tenant branding —
 * has loaded. The logo is referenced as a static asset rather than as the
 * embedded data URI the Worker uses, so 45 KB of base64 stays out of both
 * frontend bundles; the API sends the real one a moment later.
 */
export const DEFAULT_BRANDING: Branding = {
  companyName: BRAND_COMPANY_NAME,
  accentColor: BRAND_ACCENT,
  logoDataUrl: '/logo-po-motivation.png',
  supportEmail: '',
};

/** The Friendly Bold primary, used when no tenant accent has been set. */
const FRIENDLY_PRIMARY = '#0BA5C8';

/**
 * A logo wider than this contains its own wordmark — the house mark does —
 * so repeating the company name beside it would say the same thing twice.
 * Narrower marks are icons and keep the name.
 */
const LOCKUP_RATIO = 1.8;

/**
 * `size` is the rendered HEIGHT. The width follows the image's own aspect
 * ratio, because a tenant logo is rarely square and letterboxing one into a
 * square box wastes most of it.
 */
export function LogoSlot({
  branding,
  size = 32,
  onRatio,
}: {
  branding: Branding;
  size?: number;
  /** Reports the natural aspect ratio once the image has loaded. */
  onRatio?: (ratio: number) => void;
}) {
  if (branding.logoDataUrl) {
    return (
      <img
        className="logo-img"
        src={branding.logoDataUrl}
        alt={branding.companyName}
        style={{ height: size, width: 'auto', maxWidth: size * 5, objectFit: 'contain' }}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalHeight > 0) onRatio?.(img.naturalWidth / img.naturalHeight);
        }}
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
  const [logoRatio, setLogoRatio] = useState(0);
  const isLockup = logoRatio >= LOCKUP_RATIO;

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
            <LogoSlot branding={branding} size={friendly ? 40 : 30} onRatio={setLogoRatio} />
            {isLockup && !subtitle ? null : (
              <div className="brand-text">
                {/* A wordmark logo already says the company name. */}
                {isLockup ? null : <span className="brand-name">{branding.companyName}</span>}
                {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
              </div>
            )}
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
 * `--brand-*` set drives the Friendly Bold primary in the assessment flow, and
 * its pressed edge, soft fill and ink are derived from it so the chunky button
 * edges stay in the family.
 *
 * The house accent is itself a deliberate brand colour now, so it is applied
 * like any other rather than being treated as "unset" — the teal below is only
 * a fallback for a branding record that fails to parse.
 */
export function useAccent(branding: Branding): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (branding.accentColor) {
    root.style.setProperty('--accent', branding.accentColor);
    root.style.setProperty('--pull', branding.accentColor);
  }

  const primary = parseHex(branding.accentColor) ? branding.accentColor : FRIENDLY_PRIMARY;

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
