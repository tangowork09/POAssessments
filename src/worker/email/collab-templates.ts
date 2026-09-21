/**
 * The one email the Collaboration Diagnostic sends to a respondent about
 * themselves.
 *
 * Kept out of templates.ts, which is built around a candidate receiving their
 * own assessment result. This is the opposite message: the reader was not
 * assessed, and the first thing the email has to do is say so, before they
 * open a PDF with their name on it and start looking for a grade.
 */

import type { Branding } from '../../shared/types.js';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function collabSheetEmail(input: {
  branding: Branding;
  logoUrl: string;
  organisation: string;
  waveName: string;
  groupN: number;
  link: string;
}): { subject: string; html: string; text: string } {
  const company = input.branding.companyName;
  const accent = input.branding.accentColor || '#1A4FD6';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0C1421;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8EE;border-radius:12px;overflow:hidden;">
    <div style="padding:24px 28px 0;">
      <img src="${esc(input.logoUrl)}" alt="${esc(company)}" style="max-height:34px;border:0;" />
    </div>
    <div style="padding:20px 28px 28px;">
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;color:#0C1421;">Your own copy of what you said</h1>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3D4859;">
        Thank you for answering the Collaboration Diagnostic for
        <strong style="color:#0C1421;">${esc(input.organisation)}</strong> (${esc(input.waveName)}).
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3D4859;">
        This is not a score and not an assessment of you. The diagnostic measures how the organisation
        works, not the people in it, and nobody is ranked by it. Your individual answers were not shown
        to anyone.
      </p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3D4859;">
        The sheet below puts your answers next to what the other ${input.groupN - 1} people said. Where
        your reading sits apart from theirs is the part worth raising in the debrief.
      </p>
      <p style="margin:0 0 20px;">
        <a href="${esc(input.link)}" style="display:inline-block;background:${esc(accent)};color:#FFFFFF;
           text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;">
          Open your sheet
        </a>
      </p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#8D97A6;">
        This link is personal to you. Sent by ${esc(company)}.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    'Your own copy of what you said',
    '',
    `Thank you for answering the Collaboration Diagnostic for ${input.organisation} (${input.waveName}).`,
    '',
    'This is not a score and not an assessment of you. The diagnostic measures how the organisation',
    'works, not the people in it, and nobody is ranked by it. Your individual answers were not shown',
    'to anyone.',
    '',
    `The sheet puts your answers next to what the other ${input.groupN - 1} people said:`,
    input.link,
    '',
    `This link is personal to you. Sent by ${company}.`,
  ].join('\n');

  return { subject: `Your answers — ${input.organisation}`, html, text };
}
