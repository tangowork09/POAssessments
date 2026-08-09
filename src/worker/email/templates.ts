/**
 * Branded transactional mail.
 *
 * Table-based layout with inline styles — the only thing that survives Outlook,
 * Gmail and Apple Mail alike. Links are always the full destination URL: no
 * shorteners and no redirect hops, so recipients and spam filters can both see
 * where the link goes.
 */

import type { Branding } from '../../shared/types.js';

interface Shell {
  branding: Branding;
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footNote?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function logoBlock(b: Branding): string {
  if (b.logoDataUrl) {
    return `<img src="${esc(b.logoDataUrl)}" alt="${esc(b.companyName)}" width="120" style="display:block;max-width:120px;height:auto;border:0;" />`;
  }
  const initial = esc((b.companyName || 'A').trim().charAt(0).toUpperCase());
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="34" height="34" align="center" valign="middle" style="background:${esc(b.accentColor)};border-radius:6px;color:#ffffff;font:600 15px/34px -apple-system,'Segoe UI',Roboto,Arial,sans-serif;">${initial}</td>` +
    `<td style="padding-left:10px;font:600 14px/1.2 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0C1421;">${esc(b.companyName)}</td>` +
    `</tr></table>`
  );
}

function shell({ branding, preheader, heading, body, cta, footNote }: Shell): string {
  const accent = esc(branding.accentColor);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F5F7FA;">
<div style="display:none;font-size:1px;color:#F5F7FA;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F7FA;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E4E8EE;border-radius:10px;">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #E4E8EE;">${logoBlock(branding)}</td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font:680 22px/1.25 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:-0.5px;color:#0C1421;">${esc(heading)}</h1>
        <div style="font:400 15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#3D4859;">${body}</div>
        ${
          cta
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;"><tr>
                 <td style="background:${accent};border-radius:6px;">
                   <a href="${esc(cta.url)}" style="display:inline-block;padding:13px 26px;font:600 15px/1 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#FFFFFF;text-decoration:none;">${esc(cta.label)}</a>
                 </td></tr></table>
               <p style="margin:12px 0 0;font:400 12px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#8D97A6;word-break:break-all;">
                 If the button does not work, paste this address into your browser:<br><span style="color:#6A7688;">${esc(cta.url)}</span>
               </p>`
            : ''
        }
      </td></tr>
      <tr><td style="padding:20px 32px 28px;border-top:1px solid #E4E8EE;">
        <p style="margin:0;font:400 12px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#8D97A6;">
          ${footNote ? esc(footNote) + '<br>' : ''}
          Sent by ${esc(branding.companyName)}.${
            branding.supportEmail
              ? ` Questions? Reply to this message or write to <a href="mailto:${esc(branding.supportEmail)}" style="color:${accent};">${esc(branding.supportEmail)}</a>.`
              : ' Questions? Reply to this message.'
          }
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function inviteEmail(input: {
  branding: Branding;
  firstName: string;
  assessmentName: string;
  link: string;
  questionCount: number;
}): { subject: string; html: string; text: string } {
  const greeting = input.firstName ? `Hello ${esc(input.firstName)},` : 'Hello,';
  const html = shell({
    branding: input.branding,
    preheader: `Your ${input.assessmentName} is ready — about 10 minutes.`,
    heading: `Your ${input.assessmentName}`,
    body:
      `<p style="margin:0 0 14px;">${greeting}</p>` +
      `<p style="margin:0 0 14px;">${esc(input.branding.companyName)} has invited you to complete the <strong style="color:#0C1421;">${esc(input.assessmentName)}</strong>.</p>` +
      `<p style="margin:0 0 14px;">It is ${input.questionCount} short statements and takes about ten minutes. There are no right or wrong answers — answer as you actually behave at work, not as you feel you ought to.</p>` +
      `<p style="margin:0;">Your progress saves as you go, so you can stop at any point and pick up exactly where you left off.</p>`,
    cta: { label: 'Start the assessment', url: input.link },
    footNote: 'This link is personal to you and does not expire. Please do not forward it.',
  });

  const text = [
    input.firstName ? `Hello ${input.firstName},` : 'Hello,',
    '',
    `${input.branding.companyName} has invited you to complete the ${input.assessmentName}.`,
    `It is ${input.questionCount} short statements and takes about ten minutes.`,
    'Your progress saves as you go, so you can stop and resume at any point.',
    '',
    'Start the assessment:',
    input.link,
    '',
    'This link is personal to you and does not expire. Please do not forward it.',
    `Sent by ${input.branding.companyName}.`,
  ].join('\n');

  return { subject: `${input.assessmentName} — your personal link`, html, text };
}

export function reportEmail(input: {
  branding: Branding;
  firstName: string;
  assessmentName: string;
  reportUrl: string;
  attached: boolean;
}): { subject: string; html: string; text: string } {
  const greeting = input.firstName ? `Hello ${esc(input.firstName)},` : 'Hello,';
  const html = shell({
    branding: input.branding,
    preheader: `Your ${input.assessmentName} report is ready.`,
    heading: 'Your report is ready',
    body:
      `<p style="margin:0 0 14px;">${greeting}</p>` +
      `<p style="margin:0 0 14px;">Thank you for completing the <strong style="color:#0C1421;">${esc(input.assessmentName)}</strong>. Your personal report is ready to read.</p>` +
      (input.attached
        ? `<p style="margin:0;">A PDF copy is attached to this message, and the link below opens the same report in your browser.</p>`
        : `<p style="margin:0;">The link below opens your report, where you can also download it as a PDF.</p>`),
    cta: { label: 'Open your report', url: input.reportUrl },
    footNote: 'Your report is confidential. The link is private to you and does not expire.',
  });

  const text = [
    input.firstName ? `Hello ${input.firstName},` : 'Hello,',
    '',
    `Thank you for completing the ${input.assessmentName}. Your personal report is ready.`,
    input.attached ? 'A PDF copy is attached to this message.' : '',
    '',
    'Open your report:',
    input.reportUrl,
    '',
    'Your report is confidential. The link is private to you and does not expire.',
    `Sent by ${input.branding.companyName}.`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: `Your ${input.assessmentName} report`, html, text };
}
