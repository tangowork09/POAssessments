/**
 * The two exports that are not a picture.
 *
 * A PNG of a table is pixels: nobody can search it, copy a name out of it, or
 * read it on a phone. These two carry the same material as something a person
 * can actually use afterwards — a PDF whose table is real text, and a single
 * HTML file that keeps the map's hover and opens anywhere with no login.
 */

export interface DocColumn {
  head: string;
  right?: boolean;
  weight?: number;
}

export interface DocPanel {
  title: string;
  rows: [string, string][];
}

export interface DocPayload {
  round: string;
  tabTitle: string;
  question: string;
  finding: string;
  imageDataUrl?: string;
  columns: DocColumn[];
  rows: string[][];
  panels: DocPanel[];
}

/** Posts the material and downloads what comes back. */
export async function downloadInsightPdf(cohortId: string, payload: DocPayload, filename: string): Promise<void> {
  const res = await fetch(`/api/admin/cohorts/${cohortId}/insight-pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`The document could not be made (${res.status}).`);
  save(await res.blob(), `${filename}.pdf`);
}

/**
 * One self-contained page: the live SVG as it stands, the readings, and the
 * table. No script beyond what the hover needs, no network, no fonts to fetch —
 * a file that still works on a laptop with no connection in five years.
 */
export function downloadInsightHtml(
  svg: SVGSVGElement | null,
  payload: DocPayload,
  filename: string,
  subtitle: string,
): void {
  const picture = svg ? svg.outerHTML : '<p>No picture on this question.</p>';
  const head = payload.columns.map((c) => `<th${c.right ? ' class="r"' : ''}>${esc(c.head)}</th>`).join('');
  const body = payload.rows
    .map(
      (r) =>
        `<tr>${payload.columns
          .map((c, i) => `<td${c.right ? ' class="r"' : ''}>${esc(r[i] ?? '')}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const panels = payload.panels
    .map(
      (p) =>
        `<section class="panel"><h2>${esc(p.title)}</h2>${p.rows
          .map(([k, v]) => `<p><span>${esc(k)}</span><b>${esc(v)}</b></p>`)
          .join('')}</section>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(payload.tabTitle)} — ${esc(subtitle)}</title>
<style>
  :root{ color-scheme:light; --ink:#0C1421; --ink2:#3D4859; --ink3:#6A7688; --line:#E4E8EE; --surface:#FAFBFC; }
  *{ box-sizing:border-box; }
  body{ margin:0; padding:24px; background:#fff; color:var(--ink);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header{ max-width:1100px; margin:0 auto 18px; }
  h1{ font-size:20px; margin:0 0 4px; letter-spacing:-.01em; }
  .sub{ color:var(--ink3); font-size:13px; margin:0 0 14px; }
  .finding{ font-size:17px; font-weight:650; line-height:1.35; margin:0 0 18px; }
  main{ max-width:1100px; margin:0 auto; }
  .pic{ border:1px solid var(--line); border-radius:10px; padding:10px; margin-bottom:20px; overflow:auto; }
  .pic svg{ width:100%; height:auto; display:block; }
  .panels{ display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); margin-bottom:20px; }
  .panel{ border:1px solid var(--line); border-radius:10px; padding:12px 14px; background:var(--surface); }
  .panel h2{ font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink3); margin:0 0 8px; }
  .panel p{ display:flex; justify-content:space-between; gap:12px; margin:0 0 5px; font-size:13px; color:var(--ink2); }
  .panel b{ color:var(--ink); }
  table{ width:100%; border-collapse:collapse; font-size:13px; }
  th,td{ padding:7px 10px; border-bottom:1px solid var(--line); text-align:left; }
  th{ font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink3); background:var(--surface); position:sticky; top:0; }
  td.r,th.r{ text-align:right; font-variant-numeric:tabular-nums; }
  tbody tr:hover{ background:var(--surface); }
  footer{ max-width:1100px; margin:22px auto 0; color:var(--ink3); font-size:11px; }
  /* The map keeps its hover: every node carries its own title. */
  svg [data-name]:hover{ opacity:1 !important; }
  @media print{ body{ padding:0; } .pic{ break-inside:avoid; } }
</style>
<header>
  <h1>${esc(payload.tabTitle)}</h1>
  <p class="sub">${esc(subtitle)}${payload.round ? ` · ${esc(payload.round)}` : ''} · ${esc(payload.question)}</p>
  <p class="finding">${esc(payload.finding)}</p>
</header>
<main>
  <div class="pic">${picture}</div>
  ${panels ? `<div class="panels">${panels}</div>` : ''}
  ${body ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : ''}
</main>
<footer>Confidential — ${esc(subtitle)}. Saved ${new Date().toLocaleString()}.</footer>
</html>`;

  save(new Blob([html], { type: 'text/html;charset=utf-8' }), `${filename}.html`);
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoked on the next frame: revoking synchronously races the download in
  // Safari and the file arrives empty.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}
