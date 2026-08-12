/**
 * Branding resolution. Small surface, but it decides what appears on the
 * candidate header, the report, the PDF cover and every outbound email, so the
 * fallback behaviour is worth pinning down.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  attachPdf,
  brandingFrom,
  dailySendCap,
  isDefaultLogo,
  normaliseHex,
} from '../src/worker/lib/settings.js';
import { BRAND_ACCENT, BRAND_COMPANY_NAME, BRAND_LOGO_DATA_URL } from '../src/shared/brand.js';

/** The settings rows a freshly migrated database actually holds. */
const SEEDED = {
  'branding.company_name': 'PO Assessments',
  'branding.accent_color': '#0B6FB4',
  'branding.logo_data_url': '',
  'branding.support_email': '',
};

describe('brandingFrom', () => {
  it('resolves a freshly migrated database to the PO Assessments identity', () => {
    const b = brandingFrom({ ...DEFAULTS, ...SEEDED });
    expect(b.companyName).toBe(BRAND_COMPANY_NAME);
    expect(b.accentColor).toBe(BRAND_ACCENT);
    expect(b.logoDataUrl).toBe(BRAND_LOGO_DATA_URL);
    expect(b.logoDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('treats an empty logo as "no upload", not as "no logo"', () => {
    expect(isDefaultLogo(SEEDED)).toBe(true);
    expect(brandingFrom(SEEDED).logoDataUrl).toBe(BRAND_LOGO_DATA_URL);
  });

  it('lets a tenant upload override the house mark, and clearing it restore', () => {
    const uploaded = 'data:image/png;base64,AAAA';
    const withUpload = { ...SEEDED, 'branding.logo_data_url': uploaded };
    expect(brandingFrom(withUpload).logoDataUrl).toBe(uploaded);
    expect(isDefaultLogo(withUpload)).toBe(false);
    expect(brandingFrom({ ...withUpload, 'branding.logo_data_url': '' }).logoDataUrl).toBe(
      BRAND_LOGO_DATA_URL,
    );
  });

  it('falls back to the house name and accent for missing or unusable values', () => {
    const b = brandingFrom({ 'branding.company_name': '', 'branding.accent_color': 'not a colour' });
    expect(b.companyName).toBe(BRAND_COMPANY_NAME);
    expect(b.accentColor).toBe(BRAND_ACCENT);
  });

  it('normalises a tenant accent to upper-case six-digit hex', () => {
    expect(brandingFrom({ ...SEEDED, 'branding.accent_color': '#abc' }).accentColor).toBe('#AABBCC');
    expect(normaliseHex('#1a4fd6')).toBe('#1A4FD6');
    expect(normaliseHex('rgb(0,0,0)')).toBeNull();
    expect(normaliseHex(undefined)).toBeNull();
  });
});

describe('mail settings', () => {
  it('defaults a missing or nonsensical send cap to 50', () => {
    expect(dailySendCap({})).toBe(50);
    expect(dailySendCap({ 'mail.daily_send_cap': 'lots' })).toBe(50);
    expect(dailySendCap({ 'mail.daily_send_cap': '0' })).toBe(50);
    expect(dailySendCap({ 'mail.daily_send_cap': '250' })).toBe(250);
  });

  it('attaches the PDF unless it is explicitly turned off', () => {
    expect(attachPdf({})).toBe(true);
    expect(attachPdf({ 'mail.attach_pdf': 'false' })).toBe(false);
  });
});
