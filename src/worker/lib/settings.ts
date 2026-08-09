/** Key/value platform settings: branding, mail policy, active theme. */

import type { Branding } from '../../shared/types.js';
import type { Env } from '../env.js';

export const DEFAULTS: Record<string, string> = {
  'branding.company_name': 'Assessment Platform',
  'branding.accent_color': '#1A4FD6',
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

export function brandingFrom(settings: Record<string, string>): Branding {
  return {
    companyName: settings['branding.company_name'] || DEFAULTS['branding.company_name']!,
    accentColor: normaliseHex(settings['branding.accent_color']) ?? DEFAULTS['branding.accent_color']!,
    logoDataUrl: settings['branding.logo_data_url'] ?? '',
    supportEmail: settings['branding.support_email'] ?? '',
  };
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
