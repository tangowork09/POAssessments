/**
 * Emits the print edition of the Collaboration Sociometry scoring card.
 *
 * Content comes from scoring-card-content.ts, the same module the Excel
 * workbook reads, so the two cannot disagree.
 */
import { writeFileSync } from 'node:fs';
import * as C from './scoring-card-content.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rows = (list: readonly (readonly [string, string])[], monoKey = false) =>
  list
    .map(
      ([k, v]) =>
        `<tr><th class="${monoKey ? 'k mono' : 'k'}">${esc(k)}</th><td>${esc(v)}</td></tr>`,
    )
    .join('');

const rows3 = (list: readonly (readonly [string, string, string])[]) =>
  list
    .map(
      ([k, d, n]) =>
        `<tr><th class="k mono">${esc(k)}</th><td>${esc(d)}</td><td class="dim">${esc(n)}</td></tr>`,
    )
    .join('');

const pct = (n: number) => `${Math.round(n * 100)}%`;

// ------------------------------------------------------------------ ranking
const rankingTables = C.RANKING_EXAMPLE.map((net) => {
  const body = net.rows
    .map((r, i) => {
      const flag = r.suppressed
        ? '<span class="flag">below rater floor</span>'
        : '';
      return `<tr class="${r.suppressed ? 'thin' : ''}">
        <td class="rank">${i + 1}</td>
        <td class="nm">${esc(r.name)}${flag}</td>
        <td class="bar">${r.tieRate > 0 ? `<span style="width:${r.tieRate * 100}%;background:${net.color}"></span>` : ''}</td>
        <td class="num">${pct(r.tieRate)}</td>
        <td class="num dim">${r.ties}/${r.coverage}</td>
        <td class="num dim">${r.mean === null ? '—' : r.mean.toFixed(2)}</td>
      </tr>`;
    })
    .join('');
  return `<div class="netcard">
    <h4 style="border-color:${net.color}">${esc(net.name)}</h4>
    <table class="rank-t">
      <thead><tr><th></th><th>Member</th><th>Tie rate</th><th></th><th>Ties / raters</th><th>Block mean</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}).join('');

// ------------------------------------------------------------------- items
const itemRows = C.SOCIO_ITEMS.map((item) => {
  const block = C.SOCIO_BLOCKS.find((b) => b.key === item.blockKey);
  const label = block ? block.name : 'Support gap — scored alone';
  const color = block ? block.color : '#8a8f96';
  return `<tr class="${item.no === C.SOCIO_SUPPORT_GAP_ITEM ? 'gap-item' : ''}">
    <td class="num dim">${item.no}</td>
    <td class="nm">${esc(item.short)}</td>
    <td class="stmt">${esc(item.text)}</td>
    <td class="blk" style="color:${color}">${esc(label)}</td>
  </tr>`;
}).join('');

const blockRows = C.SOCIO_BLOCKS.map(
  (b) => `<tr>
    <td><span class="dot" style="background:${b.color}"></span></td>
    <td class="nm" style="color:${b.color}">${esc(b.name)}</td>
    <td class="num dim">${b.items.join(', ')}</td>
    <td>${esc(b.gloss)}</td>
  </tr>`,
).join('') +
  `<tr>
    <td><span class="dot" style="background:#8a8f96"></span></td>
    <td class="nm dim">Support gap</td>
    <td class="num dim">${C.SOCIO_SUPPORT_GAP_ITEM}</td>
    <td>where the group asks for more than it gets — never averaged into a block</td>
  </tr>`;

const bandRow = (list: readonly (readonly [string, string, string])[]) =>
  list
    .map(
      ([n, r, reading]) =>
        `<tr><th class="k">${esc(n)}</th><td class="mono dim">${esc(r)}</td><td>${esc(reading)}</td></tr>`,
    )
    .join('');

// --------------------------------------------------------- worked example
const rosterRows = C.G.members
  .map(
    (m) => `<tr>
    <td class="nm">${esc(m.name)}</td>
    <td class="dim">${esc(m.func)}</td>
    <td class="num">${m.responded ? 'yes' : 'no'}</td>
    <td class="num">${m.coverage}</td>
    <td class="num ${m.suppressed ? 'warn' : 'dim'}">${m.suppressed ? 'yes' : 'no'}</td>
  </tr>`,
  )
  .join('');

const ratingRows = C.RATING_ROWS.map(([name, v]) => {
  const cells = v
    ? [v.powerTo, v.powerOver, v.trust, v.ease, v.gap].map((x) => `<td class="num">${x}</td>`).join('')
    : '<td class="num dim">—</td>'.repeat(5);
  return `<tr><td class="nm">${esc(name)}</td>${cells}<td class="dim">${esc(C.RATED_BY[name] ?? '')}</td></tr>`;
}).join('');

const meanRows = C.G.members
  .map((m) => {
    const cells = C.SOCIO_BLOCKS.map((b) => {
      const st = m.blocks.find((x) => x.blockKey === b.key)!;
      if (st.mean === null) return '<td class="num dim">—</td>';
      return `<td class="num" style="color:${b.color}">${st.mean.toFixed(2)}<br><span class="sub">${esc(st.band!)} · ${st.ties}/${st.n}</span></td>`;
    }).join('');
    const gap =
      m.authorityTrustGap === null
        ? '<td class="num dim">—</td>'
        : `<td class="num ${m.authorityTrustGap > 0 ? 'warn' : m.authorityTrustGap < 0 ? 'good' : 'dim'}">${m.authorityTrustGap > 0 ? '+' : ''}${m.authorityTrustGap.toFixed(2)}</td>`;
    const sg =
      m.supportGap.mean === null
        ? '<td class="num dim">—</td>'
        : `<td class="num dim">${m.supportGap.mean.toFixed(2)}<br><span class="sub">${esc(m.supportGap.band!)}</span></td>`;
    return `<tr><td class="nm">${esc(m.name)}</td>${cells}${sg}${gap}</tr>`;
  })
  .join('');

const netRows = C.G.networks
  .map(
    (n) => `<tr>
    <td class="nm" style="color:${n.color}">${esc(n.name)}</td>
    <td class="num">${n.ties}</td>
    <td class="num">${n.density === null ? '—' : n.density.toFixed(2)}</td>
    <td class="num">${n.reciprocity === null ? '—' : n.reciprocity.toFixed(2)}</td>
    <td class="num">${n.concentration === null ? '—' : n.concentration.toFixed(2)}</td>
  </tr>`,
  )
  .join('');

const totalRows = C.TOTALS.map(
  ([k, v, m]) => `<tr><th class="k">${esc(k)}</th><td class="num">${esc(v)}</td><td class="dim">${esc(m)}</td></tr>`,
).join('');

const signalRows = C.SIGNAL_ROWS.map(
  ([k, who, why]) =>
    `<tr><th class="k">${esc(k)}</th><td class="mono">${esc(who)}</td><td class="dim">${esc(why)}</td></tr>`,
).join('');

// =========================================================================
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Collaboration Sociometry — Scoring Card</title>
<style>
  @page { size: A4; margin: 15mm 14mm 13mm; }
  :root {
    --ink:#16191d; --soft:#454c53; --dim:#7d858c; --faint:#9aa1a8;
    --rule:#dcdfe3; --hair:#eef0f2; --wash:#f7f8f9;
    --warn:#B4530E; --good:#0E7C5A;
  }
  *{box-sizing:border-box}
  body{margin:0;font:9.1pt/1.5 "Charter","Iowan Old Style",Georgia,serif;color:var(--ink)}
  .sans{font-family:"Inter","Helvetica Neue",Arial,sans-serif}
  .mono{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:8.3pt}

  header{border-bottom:1.8pt solid var(--ink);padding-bottom:7pt;margin-bottom:13pt}
  .kicker{font-family:"Inter",Arial,sans-serif;font-size:6.6pt;font-weight:700;letter-spacing:.17em;
    text-transform:uppercase;color:var(--dim);margin:0 0 3pt}
  h1{font-size:20pt;letter-spacing:-.015em;margin:0 0 5pt;font-weight:600}
  .lede{margin:0;color:var(--soft);font-size:9.6pt;max-width:150mm}

  h2{font-family:"Inter",Arial,sans-serif;font-size:7pt;font-weight:700;letter-spacing:.14em;
    text-transform:uppercase;margin:15pt 0 6pt;padding-bottom:3pt;border-bottom:.7pt solid var(--rule)}
  h2:first-of-type{margin-top:0}
  h3{font-family:"Inter",Arial,sans-serif;font-size:10pt;font-weight:600;margin:11pt 0 4pt}
  h4{font-family:"Inter",Arial,sans-serif;font-size:8.6pt;font-weight:600;margin:0 0 4pt;
    padding-left:6pt;border-left:2.4pt solid var(--ink)}
  p{margin:0 0 5pt}
  .note{color:var(--soft);font-size:8.6pt}
  .page-break{break-before:page}
  tr{break-inside:avoid}
  thead{display:table-header-group}
  h2,h3{break-after:avoid}
  .step,.callout,.headline{break-inside:avoid}

  table{width:100%;border-collapse:collapse;margin:0 0 6pt}
  th,td{text-align:left;padding:3.2pt 6pt 3.2pt 0;vertical-align:top;border-bottom:.4pt solid var(--hair)}
  thead th{font-family:"Inter",Arial,sans-serif;font-size:6.3pt;font-weight:600;letter-spacing:.1em;
    text-transform:uppercase;color:var(--faint);border-bottom:.6pt solid var(--rule);padding-bottom:3pt}
  tbody tr:last-child th,tbody tr:last-child td{border-bottom:none}
  th.k{font-weight:600;width:34mm;padding-right:8pt}
  td.dim,.dim{color:var(--dim)}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap}
  .nm{font-weight:600}
  .warn{color:var(--warn)}
  .good{color:var(--good)}
  .sub{font-family:"Inter",Arial,sans-serif;font-size:6.4pt;color:var(--faint);font-weight:400}
  .stmt{color:var(--soft);font-size:8.5pt}
  .blk{font-family:"Inter",Arial,sans-serif;font-size:7.2pt;font-weight:600;white-space:nowrap}
  .gap-item td{background:var(--wash)}
  .dot{display:inline-block;width:5pt;height:5pt;border-radius:50%;vertical-align:middle}

  .steps{margin:0 0 6pt}
  .step{display:flex;gap:8pt;padding:3.5pt 0;border-bottom:.4pt solid var(--hair)}
  .step:last-child{border-bottom:none}
  .step .n{font-family:"SF Mono",Menlo,monospace;font-size:7pt;color:var(--faint);flex:0 0 auto;padding-top:1pt}
  .step .l{font-weight:600;flex:0 0 30mm}
  .step .t{color:var(--soft);font-size:8.7pt}

  .callout{background:var(--wash);border-left:2.4pt solid var(--warn);padding:7pt 9pt;margin:7pt 0}
  .callout b{display:block;font-family:"Inter",Arial,sans-serif;font-size:8.6pt;margin-bottom:2.5pt}
  .callout p{font-size:8.5pt;color:var(--soft);margin:0}

  .headline{display:flex;gap:7pt;margin-bottom:8pt}
  .hl{flex:1;border-top:2.4pt solid var(--ink);padding-top:5pt}
  .hl:nth-child(1){border-color:#0E7C5A}
  .hl:nth-child(2){border-color:#B4530E}
  .hl:nth-child(3){border-color:#0B6FB4}
  .hl b{font-family:"Inter",Arial,sans-serif;font-size:9pt;display:block;margin-bottom:1.5pt}
  .hl .src{font-family:"SF Mono",Menlo,monospace;font-size:6.6pt;color:var(--faint);display:block;margin-bottom:3pt}
  .hl p{font-size:8.2pt;color:var(--soft);margin:0}

  .netcard{break-inside:avoid;margin-bottom:9pt}
  .rank-t td,.rank-t th{padding:2.6pt 5pt 2.6pt 0}
  .rank-t .rank{width:8mm;color:var(--faint);font-family:"SF Mono",Menlo,monospace;font-size:7.4pt}
  .rank-t .bar{width:42mm}
  .rank-t .bar span{display:block;height:6pt;border-radius:3pt}
  .rank-t tr.thin .nm{color:var(--warn)}
  .flag{font-family:"Inter",Arial,sans-serif;font-size:6.2pt;font-weight:600;color:var(--warn);
    margin-left:5pt;padding:1pt 3pt;border:.5pt solid var(--warn);border-radius:2pt;white-space:nowrap}

  footer{margin-top:12pt;padding-top:6pt;border-top:.7pt solid var(--rule);
    font-family:"SF Mono",Menlo,monospace;font-size:6.6pt;color:var(--faint)}
</style></head><body>

<header>
  <p class="kicker">Assessment Platform · Method Reference</p>
  <h1>Collaboration Sociometry — Scoring Card</h1>
  <p class="lede">${esc(C.SUBTITLE)}</p>
</header>

<section>
  <h2>The question this instrument answers first</h2>
  <div class="headline">
    ${C.RANKING_HEADLINES.map(
      ([t, src, d]) =>
        `<div class="hl"><b>${esc(t)}</b><span class="src">${esc(src)}</span><p>${esc(d)}</p></div>`,
    ).join('')}
  </div>
  <p class="note">All three are the same computation run on a different block of statements. Nothing in this instrument produces an overall "top person": a name leads the Trust ranking or the Power ranking, never the cohort as a whole.</p>
</section>

<section>
  <h2>How a ranking is produced</h2>
  <div class="steps">
    ${C.RANKING_STEPS.map(
      ([l, t], i) =>
        `<div class="step"><span class="n">0${i + 1}</span><span class="l">${esc(l)}</span><span class="t">${esc(t)}</span></div>`,
    ).join('')}
  </div>
  <div class="callout">
    <b>${esc(C.RANKING_CAVEAT_TITLE)}</b>
    <p>${esc(C.RANKING_CAVEAT)}</p>
  </div>
</section>

<section>
  <h2>How a rating becomes a score</h2>
  <div class="steps">
    ${C.STEPS.map(
      ([n, l, t]) =>
        `<div class="step"><span class="n">${n}</span><span class="l">${esc(l)}</span><span class="t">${esc(t)}</span></div>`,
    ).join('')}
  </div>
  <p class="note">${esc(C.TWO_STEP_NOTE)}</p>
</section>

<section>
  <h2>Configuration</h2>
  <table><tbody>${rows(C.CONFIG)}</tbody></table>
</section>

<section>
  <h2>The twelve statements</h2>
  <p class="note">Verbatim from the client workbook’s Instructions sheet, in the workbook’s own column order.</p>
  <table>
    <thead><tr><th>No</th><th>Short label</th><th>Statement</th><th>Block</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
</section>

<section>
  <h2>Two items handled unusually</h2>
  <table><tbody>${rows(C.ITEM_NOTES)}</tbody></table>
</section>

<section>
  <h2>The four blocks</h2>
  <table>
    <thead><tr><th></th><th>Block</th><th>Items</th><th>Reads</th></tr></thead>
    <tbody>${blockRows}</tbody>
  </table>
</section>

<section>
  <h2>Bands — asset blocks</h2>
  <table><tbody>${bandRow(C.ASSET_BANDS)}</tbody></table>
  <h2>Bands — support gap (item ${C.SOCIO_SUPPORT_GAP_ITEM})</h2>
  <table><tbody>${bandRow(C.GAP_BANDS)}</tbody></table>
  <p class="note">${esc(C.BAND_NOTE)}</p>
</section>

<section>
  <h2>Every figure the engine produces</h2>
  <h3>What a member receives</h3>
  <table><tbody>${rows3(C.RECEIVES)}</tbody></table>
  <h3>What a member gives</h3>
  <table><tbody>${rows3(C.GIVES)}</tbody></table>
</section>

<section>
  <h3>The group, per block</h3>
  <table><tbody>${rows3(C.PER_BLOCK)}</tbody></table>
</section>

<section>
  <h3>Group signals</h3>
  <table><tbody>${rows3(C.SIGNALS)}</tbody></table>
</section>

<div class="page-break"></div>
<section>
  <h2>A six-person cohort, worked end to end</h2>
  <p class="note">Built to exercise every mechanic above. Every figure was produced by the live scoring engine when this document was built — none of it is typed in.</p>

  <h3>The roster</h3>
  <table>
    <thead><tr><th>Member</th><th>Function</th><th>Responded</th><th>Raters</th><th>Suppressed</th></tr></thead>
    <tbody>${rosterRows}</tbody>
  </table>

  <h3>The ratings that were given</h3>
  <table>
    <thead><tr><th>Target</th><th>Power to/with</th><th>Power over</th><th>Trust</th><th>Ease</th><th>Item ${C.SOCIO_SUPPORT_GAP_ITEM}</th><th>Rated by</th></tr></thead>
    <tbody>${ratingRows}</tbody>
  </table>
  <p class="note">${esc(C.EXAMPLE_NOTE)}</p>
</section>

<section>
  <h3>Block means, bands and ties</h3>
  <table>
    <thead><tr><th>Member</th>${C.SOCIO_BLOCKS.map((b) => `<th>${esc(b.short)}</th>`).join('')}<th>Support gap</th><th>Authority − trust</th></tr></thead>
    <tbody>${meanRows}</tbody>
  </table>
</section>

<section>
  <h3>Worked by hand — Alice’s authority-trust gap</h3>
  <table><tbody>${rows(C.HAND_WORKED)}</tbody></table>
</section>

<section>
  <h2>The rankings this cohort produced</h2>
  <p class="note">Ordered by tie rate. The rater count is printed beside every figure on purpose — read the two together.</p>
  ${rankingTables}
</section>

<section>
  <h3>What the group signals picked up</h3>
  <table><tbody>${signalRows}</tbody></table>
</section>

<section>
  <h3>Network figures</h3>
  <table>
    <thead><tr><th>Block</th><th>Ties</th><th>Density</th><th>Reciprocity</th><th>Concentration</th></tr></thead>
    <tbody>${netRows}</tbody>
  </table>
  <h3>Cohort figures</h3>
  <table><tbody>${totalRows}</tbody></table>
</section>

<section>
  <h2>Rules the engine will not bend</h2>
  <p class="note">Enforced in code, not by convention. Each is covered by a unit test.</p>
  <table><tbody>${rows(C.RULES)}</tbody></table>
</section>

<section>
  <h2>Confidentiality</h2>
  <table><tbody>${rows(C.CONFIDENTIALITY)}</tbody></table>
</section>

<section>
  <h2>What the engine deliberately does not produce</h2>
  <table><tbody>${rows(C.NOT_PRODUCED)}</tbody></table>
</section>

<footer>${esc(C.SOURCE_NOTE)}</footer>
</body></html>`;

const out = process.argv[2] ?? 'scoring-card.html';
writeFileSync(out, html);
console.log('WROTE', out);
