/**
 * A realistic run, not a uniform one.
 *
 * Every earlier fixture answered the same way throughout, which proves the
 * plumbing and hides everything the reading is for. This one is built to make
 * each scenario appear at once:
 *
 *   · four departments of very different sizes, including one of four people
 *     and one of a single person, so a floor of 1 has something to show
 *   · one department that reads the organisation far harder than the others
 *   · one statement the room splits down the middle on
 *   · one statement everybody agrees is fine, and one everybody agrees is not
 *   · three people who start and never finish
 *   · some open answers, most not
 */
const B = process.env.BASE ?? 'http://localhost:8787';
const ADMIN = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe!2026';
let cookie = '';

async function call(path, { method = 'GET', body, ip } = {}) {
  const headers = { cookie };
  if (body) headers['content-type'] = 'application/json';
  if (ip) headers['cf-connecting-ip'] = ip;
  const res = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json().catch(() => null) : null };
}

const REVERSE = new Set([2, 3, 4, 7, 8, 9, 10, 12, 14, 15, 17, 18, 19, 20]);
const SPLIT_ITEM = 14;
const EVERYONE_FINE = 13;      // "people feel safe asking for help" — direct
const EVERYONE_BAD = 8;        // "we lose time finding the right expert" — reverse

/** mulberry32: an actual generator, not the toy LCG that skewed the last one. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One leader's sheet. `mood` is how healthy this person finds the place, 0
 * (bleak) to 1 (content); `index` decides which side of the split they sit on.
 */
function sheet(mood, index, rand) {
  return Array.from({ length: 24 }, (_, i) => {
    const no = i + 1;
    if (no === SPLIT_ITEM) return { no, value: index % 2 === 0 ? 5 : 1 };
    if (no === EVERYONE_FINE) return { no, value: rand() < 0.8 ? 4 : 5 };
    if (no === EVERYONE_BAD) return { no, value: rand() < 0.8 ? 5 : 4 };
    // A problem statement is agreed with when the place feels bad; a good
    // practice is agreed with when it feels good.
    const target = REVERSE.has(no) ? 5 - mood * 3 : 1.5 + mood * 3;
    const jitter = (rand() + rand() - 1) * 0.9;
    return { no, value: Math.min(5, Math.max(1, Math.round(target + jitter))) };
  });
}

const DEPARTMENTS = [
  { name: 'Commercial', people: 8, mood: 0.75 },
  { name: 'R&D', people: 6, mood: 0.6 },
  { name: 'Operations', people: 4, mood: 0.15 },   // reads it far harder
  { name: 'Quality & QA', people: 1, mood: 0.4 },  // a department of one
];
const QUOTES = [
  'Handovers between QA and Production are where everything stalls.',
  'We are measured on our own numbers and then asked to help everyone else.',
  'Nobody owns the end-to-end process, so it belongs to no one.',
  'Escalation is faster than agreement, so people escalate.',
];

await call('/api/admin/login', { method: 'POST', body: { email: ADMIN, password: PASSWORD } });

const made = await call('/api/admin/collab-runs', {
  method: 'POST',
  body: { name: 'Westwind Pharma leadership', organisation: 'Westwind Pharma', anonymous: true, minSegment: 1 },
});
const run = made.body.id;

await call(`/api/admin/collab-runs/${run}/facets`, {
  method: 'PUT',
  body: {
    facets: [
      { key: 'department', label: 'Department', options: DEPARTMENTS.map((d) => d.name), required: true },
      { key: 'level', label: 'Level', options: ['Head of function', 'Senior manager'], required: false },
    ],
  },
});
await call(`/api/admin/collab-runs/${run}`, {
  method: 'PATCH',
  body: { status: 'open', openQuestion: 'What is the single biggest barrier to working across departments here?' },
});
const link = (await call(`/api/admin/collab-runs/${run}/link`, { method: 'POST', body: {} })).body.token;

const rand = rng(90210);
let index = 0;
let finished = 0;
let abandoned = 0;

for (const dept of DEPARTMENTS) {
  for (let i = 0; i < dept.people; i++) {
    const ip = `203.0.113.${(index % 250) + 1}`;
    const started = await call(`/api/candidate/start/${link}`, {
      method: 'POST', ip,
      body: {
        facets: {
          department: dept.name,
          ...(rand() < 0.7 ? { level: rand() < 0.5 ? 'Head of function' : 'Senior manager' } : {}),
        },
      },
    });
    if (started.status !== 200) { console.log('start failed', started.status, JSON.stringify(started.body)); continue; }
    const { responseId, personalToken } = started.body;
    const mine = personalToken ?? link;
    const answers = sheet(dept.mood, index, rand);

    // Three people put it down part way through and never come back.
    if (index === 3 || index === 11 || index === 16) {
      await call(`/api/candidate/answers/${mine}?response=${responseId}`, {
        method: 'POST', ip, body: { answers: answers.slice(0, 9) },
      });
      abandoned++;
      index++;
      continue;
    }

    await call(`/api/candidate/answers/${mine}?response=${responseId}`, { method: 'POST', ip, body: { answers } });
    const done = await call(`/api/candidate/submit/${mine}`, {
      method: 'POST', ip,
      body: index % 5 === 0 ? { responseId, openAnswer: QUOTES[(index / 5) % QUOTES.length] } : { responseId },
    });
    if (done.body?.completed) finished++;
    index++;
  }
}

const results = (await call(`/api/admin/collab-runs/${run}/results`)).body;
const g = results.group;
console.log(`\nWestwind Pharma — ${finished} finished, ${abandoned} abandoned part way`);
console.log(`index ${g.total}/120 · ${g.perItem} per statement · ${g.band.name}`);
console.log(`\nsections, strongest first:`);
for (const s of [...g.sections].sort((a, b) => b.mean - a.mean)) {
  console.log(`  ${s.short.padEnd(26)} ${s.mean.toFixed(2)}  spread ${s.spread?.toFixed(2) ?? '—'}`);
}
console.log(`gap ${g.gap.value} · split items ${JSON.stringify(g.split)} · unfinished excluded: ${g.incomplete}`);
const item = (no) => g.items.find((i) => i.no === no);
console.log(`\nitem ${SPLIT_ITEM} (the split):    counts ${JSON.stringify(item(SPLIT_ITEM).counts)}  mean ${item(SPLIT_ITEM).mean}  split=${item(SPLIT_ITEM).split}`);
console.log(`item ${EVERYONE_FINE} (agreed good): counts ${JSON.stringify(item(EVERYONE_FINE).counts)}  mean ${item(EVERYONE_FINE).mean}`);
console.log(`item ${EVERYONE_BAD} (agreed bad):   counts ${JSON.stringify(item(EVERYONE_BAD).counts)}  mean ${item(EVERYONE_BAD).mean}`);
console.log('\nby department, floor of 1:');
for (const cut of results.cuts) {
  console.log(`  — ${cut.label}`);
  for (const seg of cut.segments) {
    console.log(`    ${seg.name.padEnd(16)} n=${String(seg.n).padEnd(3)} ${seg.suppressed ? 'NOT REPORTED' : seg.perItem?.toFixed(2)}`);
  }
}
console.log(`\nverbatims: ${results.comments.length}`);
for (const c of results.comments) console.log(`  “${c}”`);
console.log(`\nrun: /admin/collaboration-tests/${run}`);
