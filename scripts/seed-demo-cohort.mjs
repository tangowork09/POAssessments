/**
 * Seeds a sixty-person demo cohort against a locally running `wrangler dev`,
 * exercising the same HTTP surface the console uses: Excel import (label rows
 * name the cohort), an uneven who-rates-whom map (some rate 3, some 12), the
 * link, and a first wave of simulated respondents so the network view has
 * something to draw the moment it opens.
 *
 *   node scripts/seed-demo-cohort.mjs [base-url]
 *
 * Defaults to http://localhost:8787. Safe to run twice: each run creates a
 * fresh cohort. Local development only — it signs in with the dev credentials
 * from wrangler.jsonc and simulates candidates, neither of which belongs
 * anywhere near production.
 */

import ExcelJS from 'exceljs';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const ADMIN = { email: 'admin@example.com', password: 'ChangeMe!2026' };
const RESPONDENTS = 55; // 55 of 60 respond; each uses a distinct client IP so
// the per-IP rate limits on /start and /submit never trip (local dev only).

// Deterministic pseudo-random: the same run every time, so a bug you see is a
// bug you can see again.
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(60);

const FIRST = ['Aarav','Diya','Kabir','Meera','Rohan','Ananya','Vikram','Isha','Arjun','Nisha','Dev','Priya','Karan','Sana','Rahul','Tara','Aditya','Zoya','Nikhil','Rhea','Manav','Kavya','Samar','Leela','Yash','Mira','Ishaan','Anika','Veer','Naina'];
const LAST = ['Sharma','Patel','Rao','Iyer','Khan','Mehta','Nair','Singh','Das','Kapoor','Joshi','Reddy','Bose','Malhotra','Gupta','Chawla','Menon','Bhatt','Saxena','Verma'];
const FUNCS = ['Engineering','Sales','Operations','Finance','HR','Marketing'];

function roster() {
  const seen = new Set();
  const out = [];
  while (out.length < 60) {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      func: FUNCS[out.length % FUNCS.length],
      email: `demo${out.length + 1}@globaltech.test`,
    });
  }
  return out;
}

let cookie = '';
async function call(method, path, body, ip) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie,
      // A per-respondent source IP spreads the candidate calls across rate-limit
      // buckets, so a whole cohort can be simulated in one run.
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const people = roster();

// 1. sign in
await call('POST', '/api/admin/login', ADMIN);
console.log('signed in');

// 2. the workbook, exactly as a client would send it
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Roster');
ws.addRow(['Cohort', 'Demo Sixty — GlobalTech']);
ws.addRow(['Organisation', 'GlobalTech Industries']);
ws.addRow(['Name', 'Function', 'Email']);
for (const p of people) ws.addRow([p.name, p.func, p.email]);
const fileBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

const imported = await call('POST', '/api/admin/cohorts/import', {
  fileBase64,
  filename: 'demo-sixty.xlsx',
});
const cohortId = imported.id;
console.log(`imported cohort ${imported.name} (${imported.size} people) → ${cohortId}`);

// 3. member ids, in roster order
const detail = await call('GET', `/api/admin/cohorts/${cohortId}`);
const members = detail.roster.filter((m) => m.active);

// 4. an org-shaped assignment map, not a ring: mostly your own department,
// a couple of org-wide hub leaders everyone rates, and a sprinkle of random
// cross-department pairs. A ring lattice renders as a donut with an empty
// middle — true to the data, wrong as a demo of a real organisation.
const HUBS = [members[7], members[23], members[41]]; // three org-wide figures
const assignments = members.map((m, i) => {
  const k = 3 + ((i * 7) % 10);
  const dept = people[i].func;
  const sameDept = members.filter((x, j) => j !== i && people[j].func === dept);
  const targets = new Set();
  for (const h of HUBS) if (h.memberId !== m.memberId) targets.add(h.memberId);
  // One bounded pass over the department, then bounded random fill — a hub
  // inside the rater's own department shrinks the union, so open-ended loops
  // here can never be trusted to terminate.
  for (let step = 1; step <= sameDept.length && targets.size < k; step++) {
    targets.add(sameDept[(i + step) % sameDept.length].memberId);
  }
  for (let tries = 0; tries < 400 && targets.size < k; tries++) {
    const r = members[Math.floor(rand() * members.length)];
    if (r.memberId !== m.memberId) targets.add(r.memberId);
  }
  return { raterMemberId: m.memberId, targetMemberIds: [...targets] };
});
await call('PUT', `/api/admin/cohorts/${cohortId}/assignments`, { assignments });
console.log(`assignment map set: ${assignments.reduce((n, a) => n + a.targetMemberIds.length, 0)} pairs`);

// 5. open + link
await call('PATCH', `/api/admin/cohorts/${cohortId}`, { status: 'open' });
const link = await call('POST', `/api/admin/cohorts/${cohortId}/link`);
const token = link.url.split('/t/')[1];
console.log(`opened; link ${link.url}`);

// 6. first wave of respondents, each answering every statement about every
// assigned colleague (the per-leader all-or-nothing rule) and leaving a few
// colleagues untouched, which is the instrument's own "no basis to judge".
for (let i = 0; i < RESPONDENTS; i++) {
  const me = members[i];
  const mine = assignments[i].targetMemberIds
    .map((id) => members.find((m) => m.memberId === id))
    .filter(Boolean);
  const ip = `10.1.${Math.floor(i / 256)}.${i % 256}`;
  // Identity is the enrolled email alone — the same door a real respondent uses.
  const started = await call('POST', `/api/candidate/start/${token}`, {
    email: people[i].email,
  }, ip);
  const responseId = started.responseId;

  const skip = mine.length > 4 ? Math.floor(rand() * mine.length) : -1; // one left blank
  const answers = [];
  mine.forEach((t, idx) => {
    if (idx === skip) return;
    // A personality per rater and per pair, so the map has structure: means
    // drift between ~2.4 and ~4.8 rather than clustering on one value.
    const base = 2.4 + rand() * 2.4;
    for (let item = 1; item <= 12; item++) {
      const v = Math.max(1, Math.min(5, Math.round(base + (rand() - 0.5) * 1.6)));
      answers.push({ no: (t.no - 1) * 12 + item, value: v });
    }
  });
  for (let at = 0; at < answers.length; at += 200) {
    await call('POST', `/api/candidate/answers/${token}?response=${responseId}`, {
      answers: answers.slice(at, at + 200),
    }, ip);
  }
  await call('POST', `/api/candidate/submit/${token}`, { responseId }, ip);
  console.log(`  ${me.name} submitted (${answers.length / 12} colleagues rated)`);
}

console.log('\ndone.');
console.log(`cohort:      ${BASE}/admin/cohorts  → open "Demo Sixty — GlobalTech"`);
console.log(`participant: ${link.url}`);
