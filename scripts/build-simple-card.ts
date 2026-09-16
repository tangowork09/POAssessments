/**
 * The plain-language edition of the scoring card: one page, tables only, no
 * code identifiers. For clients who want to know how the figures are reached
 * without reading the engine.
 *
 * Figures still come from the live scoring engine via scoring-card-content.ts.
 */
import { writeFileSync } from 'node:fs';
import { G, ON_ALICE, SOCIO_BLOCKS, SOCIO_TIE_THRESHOLD } from './scoring-card-content.js';

const alice = G.members.find((m) => m.name === 'Alice')!;
const over = alice.blocks.find((b) => b.blockKey === 'power_over')!;
const trust = alice.blocks.find((b) => b.blockKey === 'trust')!;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const PLAIN: Record<string, string> = {
  power_to: 'Who people go to — for judgement, for resources, to get things moving.',
  power_over: 'Who the group defers to — whose position others fall in line with, whose approval carries consequences.',
  trust: 'Who is relied on — delivers as promised, and is safe to admit a mistake to.',
  ease: 'Who is straightforward and productive to work with.',
};

const blockRows = SOCIO_BLOCKS.map(
  (b) => `<tr>
    <td class="nm" style="color:${b.color}">${b.name}</td>
    <td class="num">${b.items.length === 1 ? b.items[0] : `${b.items[0]}–${b.items[b.items.length - 1]}`}</td>
    <td>${PLAIN[b.key]}</td>
  </tr>`,
).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>How the Collaboration Sociometry scores are worked out</title>
<style>
  @page { size: A4; margin: 11mm 14mm 9mm; }
  :root{--ink:#1a1d21;--soft:#41484e;--dim:#767d84;--rule:#c9ced3;--hair:#e6e9ec;--wash:#f5f7f8;
        --trust:#0E7C5A;--over:#B4530E}
  *{box-sizing:border-box}
  body{margin:0;font:9.3pt/1.34 "Charter","Iowan Old Style",Georgia,serif;color:var(--ink)}

  header{border-bottom:2pt solid var(--ink);padding-bottom:6pt;margin-bottom:9pt}
  h1{font-family:"Inter","Helvetica Neue",Arial,sans-serif;font-size:15.5pt;font-weight:600;
     letter-spacing:-.01em;margin:0 0 4pt}
  header p{margin:0;color:var(--soft);font-size:10pt}

  h2{font-family:"Inter",Arial,sans-serif;font-size:8.2pt;font-weight:700;letter-spacing:.1em;
     text-transform:uppercase;color:var(--ink);margin:8.5pt 0 3.5pt}
  h2:first-of-type{margin-top:0}

  table{width:100%;border-collapse:collapse;margin-bottom:2pt}
  th,td{text-align:left;padding:2.9pt 7pt 2.9pt 0;vertical-align:top;border-bottom:.5pt solid var(--hair)}
  thead th{font-family:"Inter",Arial,sans-serif;font-size:7.4pt;font-weight:600;letter-spacing:.08em;
    text-transform:uppercase;color:var(--dim);border-bottom:1pt solid var(--rule)}
  tr:last-child td{border-bottom:none}
  .nm{font-weight:600;white-space:nowrap}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dim)}
  td:last-child,th:last-child{padding-right:0}

  .steps td{padding:3.6pt 7pt 3.6pt 0}
  .steps .n{width:9mm;font-family:"Inter",Arial,sans-serif;font-weight:700;color:var(--dim);font-size:10pt}

  .ex{background:var(--wash);padding:7pt 10pt;margin-top:3pt}
  .ex table{margin:0}
  .ex td,.ex th{border-bottom:.5pt solid #dfe3e6;padding:3pt 8pt 3pt 0}
  .ex tr:last-child td{border-bottom:none}
  .ex .big{font-size:12pt;font-weight:700;font-variant-numeric:tabular-nums}
  .t{color:var(--trust)} .o{color:var(--over)}

  .care td{padding:3pt 7pt 3pt 0}
  .care .nm{width:52mm}

  footer{margin-top:8pt;padding-top:5pt;border-top:.5pt solid var(--rule);
    font-size:8.6pt;color:var(--dim)}
</style></head><body>

<header>
  <h1>How the scores are worked out</h1>
  <p>Collaboration Sociometry — a plain-language summary</p>
</header>

<h2>What we ask</h2>
<p style="margin:0 0 3pt">Everyone rates everyone else they work with, on twelve short statements, from
<b>1 — not at all true</b> to <b>5 — completely true</b>. If you do not really work with someone you
leave them blank — a blank is a proper answer, and is never treated as a zero.</p>

<h2>The four things we measure</h2>
<table>
  <thead><tr><th>We call it</th><th>Statements</th><th>What it tells you</th></tr></thead>
  <tbody>
    ${blockRows}
    <tr><td class="nm" style="color:#767d84">Support gap</td><td class="num">12</td>
      <td>Who the group would like more help from. Kept separate, because a high score here is a request, not a strength.</td></tr>
  </tbody>
</table>

<h2>How we decide who is most trusted, and who has most power</h2>
<table class="steps">
  <tbody>
    <tr><td class="n">1</td><td>Take one person. For <b>each colleague who rated them</b>, average that colleague's answers on the relevant statements — one score per colleague.</td></tr>
    <tr><td class="n">2</td><td>If that score is <b>${SOCIO_TIE_THRESHOLD} or above</b>, the colleague counts as a vote. Four is "mostly true" — the first point where someone agrees rather than half-agrees.</td></tr>
    <tr><td class="n">3</td><td>We rank on the <b>share of their raters who voted</b>, not the number of votes — so someone known by three people and someone known by twelve compare fairly.</td></tr>
    <tr><td class="n">4</td><td>Run on the <b>trust statements</b> this gives <b>most trusted</b>; on the <b>power statements</b>, <b>most power</b>. The same method, a different set of statements.</td></tr>
  </tbody>
</table>

<h2>An example</h2>
<div class="ex">
  <p style="margin:0 0 5pt">Alice was rated by ${alice.coverage} colleagues. All ${alice.coverage} rated her <b>${ON_ALICE.powerOver}</b> on the power statements and <b>${ON_ALICE.trust}</b> on the trust statements.</p>
  <table>
    <thead><tr><th></th><th>Colleagues who voted</th><th>Share</th><th>Average</th><th>How it reads</th></tr></thead>
    <tbody>
      <tr><td class="nm o">Power over</td><td class="num">${over.ties} of ${over.n}</td>
        <td class="big o">${pct(over.tieRate!)}</td><td class="num">${over.mean!.toFixed(2)}</td>
        <td>Top of the group. People fall in line with her.</td></tr>
      <tr><td class="nm t">Trust</td><td class="num">${trust.ties} of ${trust.n}</td>
        <td class="big t">${pct(trust.tieRate!)}</td><td class="num">${trust.mean!.toFixed(2)}</td>
        <td>Bottom of the group. People do not rely on her to the same degree.</td></tr>
    </tbody>
  </table>
  <p style="margin:5pt 0 0;font-size:9.3pt">Alice therefore has <b>a great deal of power and little trust</b> — a gap of
  ${alice.authorityTrustGap!.toFixed(2)} points. That gap is one of the most useful things the exercise shows, and it is
  a finding about the group's relationship with her, not a judgement of her ability.</p>
</div>

<h2>What we are careful about</h2>
<table class="care">
  <tbody>
    <tr><td class="nm">We always show the numbers behind a figure</td>
      <td>Every score is printed with how many colleagues it came from. A high score from two people is not the same as a high score from twelve.</td></tr>
    <tr><td class="nm">Too few raters, no individual report</td>
      <td>If fewer than ${G.minRaters} colleagues rated someone, we produce no profile for them. In a small group, an average of one or two people is really just a quotation.</td></tr>
    <tr><td class="nm">Nobody is told who said what</td>
      <td>No report names a rater, and no figure can be traced back to one person.</td></tr>
    <tr><td class="nm">There is no single overall score</td>
      <td>We do not add the parts into one number, and we produce no league table of people. Someone leads on trust, or on power — never "overall".</td></tr>
  </tbody>
</table>

<footer>Every figure in the example above was produced by the live scoring engine, not typed in by hand.</footer>
</body></html>`;

writeFileSync(process.argv[2] ?? 'simple-card.html', html);
console.log('WROTE', process.argv[2]);
