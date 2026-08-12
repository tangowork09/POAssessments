/**
 * PO Assessments house brand.
 *
 * The logo is embedded as a data URI rather than fetched, because every place
 * it appears — the candidate header, the report sheet, the PDF header and the
 * transactional emails — is rendered somewhere a relative URL would not
 * resolve (a mail client, a downloaded PDF, an offline print). The bytes are
 * the transparent PNG in `public/logo-po-motivation.png` — the filename
 * predates the rename and the image itself still carries the old wordmark
 * pending a replacement asset; `npm run brand:logo` (scripts/gen-logo.mjs)
 * regenerates the embedded copy from whatever PNG is at that path.
 *
 * A tenant that uploads its own logo in the Branding panel overrides this; the
 * default is what an untouched installation shows.
 */

export const BRAND_COMPANY_NAME = 'PO Assessments';
export const BRAND_TAGLINE = 'Potential, Possibilities';

/**
 * Accent sampled from the blue lobe of the logo mark and darkened to 5.3:1
 * against white, so white text on an accent-filled button passes AA.
 */
export const BRAND_ACCENT = '#0B6FB4';

/** Intrinsic pixel size of the logo, used to keep its aspect ratio everywhere. */
export const BRAND_LOGO_WIDTH = 331;
export const BRAND_LOGO_HEIGHT = 140;
export const BRAND_LOGO_RATIO = BRAND_LOGO_WIDTH / BRAND_LOGO_HEIGHT;

export { BRAND_LOGO_DATA_URL } from './brand-logo.js';
