/** Key/value platform settings: branding, mail policy, active theme. */

import { BRAND_ACCENT, BRAND_COMPANY_NAME, BRAND_LOGO_DATA_URL } from '../../shared/brand.js';
import type { Branding } from '../../shared/types.js';
import type { Env } from '../env.js';

export const DEFAULTS: Record<string, string> = {
  'branding.company_name': BRAND_COMPANY_NAME,
  'branding.accent_color': BRAND_ACCENT,
  // Empty means "no upload", which resolves to the house logo in brandingFrom.
  'branding.logo_data_url': '',
  'branding.support_email': '',
  'mail.daily_send_cap': '50',
  'mail.attach_pdf': 'true',
  'theme.active': 'enterprise',
};

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{
    key: string;
    value: string;
  }>();
  const out = { ...DEFAULTS };
  for (const row of results ?? []) out[row.key] = row.value;
  return out;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value)
    .run();
}

/**
 * Resolves the stored settings into the Branding every surface renders.
 *
 * An empty `branding.logo_data_url` is not "no logo" — it is "no upload", and
 * falls back to the house mark that ships in the bundle. That is
 * what makes clearing an uploaded logo restore the default rather than leaving
 * the product unbranded, and it means the header, report, PDF and emails all
 * carry a mark out of the box.
 */
export function brandingFrom(settings: Record<string, string>): Branding {
  return {
    companyName: settings['branding.company_name'] || DEFAULTS['branding.company_name']!,
    accentColor: normaliseHex(settings['branding.accent_color']) ?? DEFAULTS['branding.accent_color']!,
    logoDataUrl: settings['branding.logo_data_url'] || BRAND_LOGO_DATA_URL,
    supportEmail: settings['branding.support_email'] ?? '',
  };
}

/** True when the current logo is the house mark rather than a tenant upload. */
export function isDefaultLogo(settings: Record<string, string>): boolean {
  return !settings['branding.logo_data_url'];
}

export async function getBranding(env: Env): Promise<Branding> {
  return brandingFrom(await getSettings(env));
}

/** Accepts #rgb / #rrggbb, case-insensitive; returns null for anything else. */
export function normaliseHex(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return ('#' + v[1]! + v[1]! + v[2]! + v[2]! + v[3]! + v[3]!).toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  return null;
}

export function dailySendCap(settings: Record<string, string>): number {
  const n = Number.parseInt(settings['mail.daily_send_cap'] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export function attachPdf(settings: Record<string, string>): boolean {
  return (settings['mail.attach_pdf'] ?? 'true') === 'true';
}
