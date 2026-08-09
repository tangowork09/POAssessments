# Assessment Platform

A psychometric assessment platform on Cloudflare Workers. One deploy serves the
candidate experience, the admin console and the API from a single `workers.dev`
subdomain — no domain, no separate frontend host, no build server.

Ships with two instruments, both live:

- **Influencing Style Inventory** — 40 statements rated 0–4, ten styles, a
  Push/Pull split and a banded report.
- **Ego States Scale** — 66 statements rated 0–6, six transactional-analysis ego
  states scored by column, and an ego-gram.

House branding is **PO Motivation** (*Potential, Possibilities*), and a tenant
can override the name, accent and logo from the console.

---

## What it does

**Candidates** open a link, read the instrument's own begin-test screen — its
title, its logo and its rating anchors, verbatim — enter their details, answer
one statement at a time, and receive a report by email. Every answer is saved the moment it is given and mirrored to
`localStorage`; going offline queues answers locally and flushes them on
reconnect. Closing the tab and returning to the link resumes at the exact page.

**Administrators** sign in at `/admin` to see live counts, invite people singly
or by CSV, watch a batch send under a daily cap, filter and bulk-action the
candidates grid, export to CSV or Excel, and manage the always-active assessment
links. Branding — which reaches the candidate UI, the PDF and the emails at once
— belongs to the **superadmin** role only; see *Administrator roles* below.

### Route separation

The candidate experience and the admin console are **two separate frontend
shells** with no shared layout, router or bundle:

| URL | Shell |
| --- | --- |
| `/` | Candidate — a neutral landing page |
| `/t/:token` | Candidate — the assessment |
| `/r/:token` | Candidate — a report |
| `/admin`, `/admin/*` | Admin console |

The Worker is the only place that maps a URL to a document, so this cannot drift
(`src/worker/index.ts`). No candidate-facing page links to `/admin`, and the
candidate bundle contains no reference to it — administrators reach the console
by typing the URL.

### Links

A link token is 32 bytes of CSPRNG output in base64url. The URL carries nothing
else: no assessment name, no candidate identity, no encoded id. The database
stores only `HMAC-SHA256(token, LINK_TOKEN_SECRET)`, so a database copy cannot
be turned back into working links — and so the plaintext of an existing link
cannot be displayed again later.

Two kinds:

- **Personal** — bound to `(candidate, assessment)`. Sent in invitations;
  enables tracking and resume. A completed personal link resolves to that
  candidate's completion screen and their report.
- **Generic** — bound to an assessment only, exactly one per assessment,
  enforced by a partial unique index. A visitor enters their details and gets
  their own response plus a personal continuation link.

**Links never expire.** There is no TTL, no expiry column and no expiry check
anywhere in the codebase. The only way a link stops working is an administrator
setting `links.active = 0` from the console.

### Multiple assessments

The `assessments` table drives questions, linking and the rating bounds the API
enforces. What is *code*-shaped — which scoring engine an instrument uses, the
anchors it shows, and its begin-test copy — lives in one registry,
`src/shared/assessments.ts`. An instrument seeded in D1 with no registry entry
has no scoring engine, so `buildReport` refuses it rather than guessing; the
Motivation Need Assessment is seeded `planned` and is in exactly that state.

Report payloads are a **tagged union** (`ReportPayload = IsiReportPayload |
EgoReportPayload`). The HTML report page, the PDF writer and the exports all
switch on `kind`, so one instrument cannot be rendered through another's layout
by accident.

### Administrator roles

| Role | Branding | Everything else |
| --- | --- | --- |
| `superadmin` | yes | yes |
| `admin` | **no** — nav item hidden, routes answer 403 | yes |

The account seeded from `ADMIN_EMAIL` on first boot is the `superadmin` — it owns
the deployment. Client administrators are created as plain `admin`.

---

## Scoring

### Influencing Style Inventory

Each statement is answered **0–4** on the published anchors — 0 *I never do it*,
1 *I rarely do this*, 2 *I sometimes do this*, 3 *I often do this*, 4 *I always
do this*. A style is the sum of its four statements, so **0–16**. Push and Pull
are the sums of their five styles, out of **80**.

| Push | Items | Pull | Items |
| --- | --- | --- | --- |
| Force | 1, 13, 21, 31 | Personal Magnetism | 9, 17, 30, 38 |
| Rules & Standards | 7, 12, 24, 32 | Visioning | 3, 11, 25, 35 |
| Exchange | 2, 14, 29, 34 | Bridging / Consensus | 4, 16, 26, 39 |
| Persuasion | 5, 18, 22, 33 | Environmental | 10, 15, 27, 36 |
| Assertion | 6, 19, 28, 37 | Joint Problem Solving | 8, 20, 23, 40 |

Bands: **0–6 Low · 7–11 Moderate · 12–16 High**.

The map is asserted to cover statements 1–40 exactly once
(`tests/scoring.test.ts`), so a future edit cannot silently drop or double-count
a statement.

### Ego States Scale

Each statement is answered **0–6**. The source instrument lays the 66 statements
out six to a row and scores by *column*, so statement `n` belongs to ego state
`((n − 1) mod 6) + 1` — eleven statements per state, each state out of **66**,
reported as a percentage of that.

| Column | State (draft) | Statements |
| --- | --- | --- |
| 1 | Critical Parent (CP) | 1, 7, 13 … 61 |
| 2 | Nurturing Parent (NP) | 2, 8, 14 … 62 |
| 3 | Adult — Perceiving (A-P) | 3, 9, 15 … 63 |
| 4 | Adult — Processing (A-Pr) | 4, 10, 16 … 64 |
| 5 | Free Child (FC) | 5, 11, 17 … 65 |
| 6 | Rebellious Child (RC) | 6, 12, 18 … 66 |

> **The state names and their descriptive copy are a DRAFT pending confirmation
> by the client.** The source workbook labels the six columns only as "St no
> 1..6". The names, abbreviations and narrative text in `src/shared/ego.ts` are
> ours; they are declared as data so a rename is a one-line change, and every
> surface that shows them — the report page, the PDF and the ego-gram — carries a
> visible "draft" note. The scores themselves are final.

`tests/ego-scoring.test.ts` reads the client's own worked example straight out of
`data/assessments_extracted.json` rather than trusting a transcription, and
asserts the engine reproduces its published column totals — 54, 59, 55, 52, 49,
51 — and its percentages. It also asserts the column-sum property across
randomised inputs, so the engine is pinned by a rule and not only by one
fixture.

---

## Stack

- **Cloudflare Workers + Hono** — API and static assets from one Worker
- **React + Vite + TypeScript** — two entry points, hand-rolled CSS tokens
- **D1** (SQLite) — `migrations/`
- **Cloudflare Queues** — score → PDF → email; runs inline when no queue is bound
- **Resend** — optional; without it, mail is logged and stored in a D1 outbox
- **jose + bcryptjs** — admin JWT in an httpOnly cookie
- **zod** — every public request body
- **exceljs** — Excel export

### PDF generation

Reports are produced by a small, dependency-free PDF writer
(`src/worker/pdf/`). This is a deliberate deviation from the original plan of
`@react-pdf/renderer`, which **cannot run on workerd**. Both blockers were
confirmed by spike rather than assumed:

1. Its layout engine, `yoga-layout`, ships as base64 WebAssembly and calls
   `WebAssembly.instantiate` on those bytes at runtime. The Workers runtime
   forbids compiling Wasm from bytes: *"Wasm code generation disallowed by
   embedder."* This is solvable — extract the `.wasm`, import it as a module and
   feed it through emscripten's `instantiateWasm` hook — and the spike got that
   far.
2. Behind it, `@react-pdf/pdfkit` drives a bundled `readable-stream` shim whose
   `process.nextTick` polyfill schedules a `setTimeout` that workerd rejects as
   being outside an I/O context.

Two layers of patching a library into a runtime it does not target is not a
sound production dependency. The writer that replaced it renders text with real
Adobe Helvetica advance widths (generated into `src/worker/pdf/afm.ts` by
`scripts/gen-afm.mjs`), word wrapping, Bezier paths, rounded rectangles,
clipping and real axial `/Shading` gradients, with a byte-accurate xref table.

Each instrument gets a six-page document: a cover, an executive summary, and
then its own chapters — Push/Pull with the two method descriptions verbatim, the
ten-style banded profile and the narrative pages for the Inventory; the ego-gram,
the highest/lowest reading and the six state pages for the Ego States Scale.
Every page carries a confidentiality line, the company name and `Page N of M`.

The PO Motivation lockup on the cover and in the running header is drawn as
**vector** — two rotated elliptical rings under a multi-stop gradient, plus the
wordmark — rather than embedded as a raster. That keeps the document
self-contained, deterministic and around 65 KB, which is the whole point of
having a writer rather than a dependency. Output was verified by rendering every
page to PNG and inspecting it, and is covered by structural tests
(`tests/pdf.test.ts`).

The HTML report page and the PDF render from the same `ReportPayload`, so they
cannot disagree.

---

## Local development

Requires Node 20+.

```bash
npm install
npm run db:migrate:local     # applies migrations to the local D1
npm run build:web            # the Worker serves ./dist/client
npx wrangler dev             # http://localhost:8787
```

The development defaults in `wrangler.jsonc` seed an administrator on first
boot:

```
email:    admin@example.com
password: ChangeMe!2026
```

Sign in at <http://localhost:8787/admin>. With no `RESEND_API_KEY` set, every
email is written to the `mail_outbox` table and echoed to the console — the
whole flow works end to end with no accounts anywhere.

```bash
npm run build     # frontend build + worker typecheck
npm test          # vitest
```

After changing the brand PNG in `public/`, regenerate the copy the Worker embeds
in PDFs and emails:

```bash
node scripts/gen-logo.mjs
```

`npm run dev:web` starts Vite with HMR on port 5173, proxying `/api` to a
`wrangler dev` on 8787.

### Smoke test

```bash
# admin session — the response carries the role
curl -s -c ck.txt -X POST localhost:8787/api/admin/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe!2026"}'
# → {"user":{...,"role":"superadmin"}}

# the always-active generic link per assessment; both instruments are live
curl -s -b ck.txt localhost:8787/api/admin/links
curl -s -b ck.txt -X POST localhost:8787/api/admin/links/generic/asm_ta_ego_states

# invite (returns the personal link)
curl -s -b ck.txt -X POST localhost:8787/api/admin/invites/single \
  -H 'content-type: application/json' \
  -d '{"assessmentId":"asm_influencing_style","firstName":"Ada",
       "email":"ada@example.com","organisation":"Northwind","send":true}'

TOKEN=...                                     # from the url above
curl -s localhost:8787/t/$TOKEN | head        # candidate shell HTML
curl -s localhost:8787/api/candidate/session/$TOKEN

# details, answers, submit
curl -s -X POST localhost:8787/api/candidate/start/$TOKEN \
  -H 'content-type: application/json' \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com",
       "organisation":"Northwind","ageBand":"25-34",
       "experienceBand":"1-5 years","gender":"Female"}'
# → responseId

# ratings are bounded by the instrument: the Inventory takes 0-4, the Ego
# States Scale 0-6, and anything outside its own range is a 400.
curl -s -X POST "localhost:8787/api/candidate/answers/$TOKEN?response=$RID" \
  -H 'content-type: application/json' \
  -d '{"answers":[{"no":1,"value":4}],"resumePage":0}'
curl -s -X POST "localhost:8787/api/candidate/answers/$TOKEN?response=$RID" \
  -H 'content-type: application/json' \
  -d '{"answers":[{"no":1,"value":5}]}'      # → 400 on the Inventory

curl -s -X POST localhost:8787/api/candidate/submit/$TOKEN \
  -H 'content-type: application/json' -d "{\"responseId\":\"$RID\"}"
# → { "completed": true, "reportToken": "..." }

curl -s localhost:8787/api/report/$REPORT_TOKEN          # JSON, tagged with "kind"
curl -s -o r.pdf localhost:8787/api/report/$REPORT_TOKEN/pdf

# branding is superadmin-only
curl -s -b ck.txt localhost:8787/api/admin/branding      # → PO Motivation + logo
```

---

## Deploying

### 1. Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up>. The free plan covers the
Worker, static assets and 5 GB of D1. Queues requires the **Workers Paid** plan
($5/month); see *Running without Queues* below if you would rather not.

```bash
npx wrangler login
```

### 2. Database

```bash
npx wrangler d1 create assessment_platform
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing
`REPLACE_WITH_D1_DATABASE_ID`, then:

```bash
npx wrangler d1 migrations apply assessment_platform --remote
```

### 3. Queues

```bash
npx wrangler queues create assessment-pipeline
npx wrangler queues create assessment-pipeline-dlq
```

### 4. Secrets

Never commit these. `wrangler.jsonc` holds development placeholders only; a
`secret` of the same name overrides the `var` in production.

```bash
openssl rand -base64 32 | npx wrangler secret put LINK_TOKEN_SECRET
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD      # used once, on first boot
npx wrangler secret put RESEND_API_KEY      # optional — see below
```

> Rotating `LINK_TOKEN_SECRET` invalidates every existing link and report URL,
> because lookup is by keyed hash. Set it once, before going live.

### 5. Deploy

```bash
npm run deploy
```

Wrangler prints the URL, e.g. `https://assessment-platform.<subdomain>.workers.dev`.
Set `PUBLIC_BASE_URL` in `wrangler.jsonc` to that origin so links in emails point
at the right place, then deploy again.

Sign in at `/admin` with the seeded credentials and change the password by
updating the `ADMIN_PASSWORD` secret and clearing the `admin_users` row, or by
inserting your own row with a bcrypt hash.

### Running without Queues

If you would rather stay on the free plan, delete the `queues` block from
`wrangler.jsonc`. `dispatch()` detects the missing binding and runs the same
pipeline inline behind `waitUntil` (`src/worker/pipeline.ts`). Scoring, the PDF
and the email all still happen after the response; you lose automatic retries
and the dead-letter queue.

---

## Email

Without `RESEND_API_KEY` every message is stored in `mail_outbox` with status
`logged` and printed to the console. Nothing breaks and no account is needed.

To send for real:

1. Create an account at <https://resend.com> (3,000 emails/month free).
2. Add and verify your sending domain — Resend gives you the SPF, DKIM and
   DMARC records to add at your DNS provider. Delivery to Gmail and Outlook
   depends on this; without it, mail from a shared domain will land in spam.
3. `npx wrangler secret put RESEND_API_KEY`
4. Set `MAIL_FROM` in `wrangler.jsonc` to an address on the verified domain
   (`"Meridian Group <assessments@meridian.example>"`), and `MAIL_REPLY_TO` if
   replies should go elsewhere. The Reply-To shown in the mail footer is set
   per-tenant in the Branding panel.
5. Deploy.

The **Sending** card on the Invites panel sets the daily cap (default 50) and
whether report emails carry the PDF as an attachment. The cap is a UTC-day
ledger consumed by single invites, resends and batch sends alike.

---

## Adding a custom domain later

Nothing in the code assumes `workers.dev`.

1. Add the domain to Cloudflare (or transfer its nameservers).
2. Workers & Pages → your Worker → **Settings → Domains & Routes → Add custom
   domain**. Cloudflare provisions the certificate.
3. Set `PUBLIC_BASE_URL` in `wrangler.jsonc` to `https://your-domain`, and
   redeploy. Existing links keep working — only newly generated URLs use the new
   origin, and old ones still resolve on the `workers.dev` host.
4. Move the Resend sending domain to the new domain and re-verify DNS.
5. The session cookie is `Secure` on any https origin automatically.

---

## Cost

| | Free plan | Notes |
| --- | --- | --- |
| Workers | 100,000 requests/day | An assessment is roughly 60 requests |
| Workers Assets | Unlimited, free | Static bundle |
| D1 | 5 GB, 5M reads/day | Reports store the PDF; ~18 KB each |
| Queues | Paid only ($5/mo) | Optional — see above |
| Resend | 3,000 emails/month | Two per candidate (invite + report) |

A cohort of a few thousand candidates a month fits inside the free tier apart
from Queues. The dominant storage cost is the stored PDFs; at 18 KB each, 5 GB
holds roughly 280,000 reports.

---

## Layout

```
migrations/          D1 schema and seed data
data/                Source question JSON (the extract this repo was seeded from)
public/              Brand assets (the PO Motivation logo)
scripts/gen-afm.mjs  Regenerates the Helvetica metric tables
scripts/gen-logo.mjs Regenerates the embedded logo data URI from the PNG
src/shared/          Assessment registry, both scoring engines, brand, wire types
src/worker/
  index.ts           Entry: routing, shell selection, queue consumer
  bootstrap.ts       First-boot admin and generic-link seeding
  pipeline.ts        score → PDF → email, queued or inline
  routes/            candidate, report, admin
  lib/               tokens, auth, mailer, settings, rate limiting, validation
  pdf/               PDF writer, report layout, Adobe metrics
  email/             Branded HTML templates
web/
  index.html         Candidate shell
  admin.html         Admin shell
  src/candidate/     Welcome, details, statements, completion, report
  src/admin/         Login, console shell, six panels
  src/styles/        base.css (shared tokens) + candidate.css + admin.css
tests/               Both scoring engines, the registry, tokens, CSV, PDF
```

## Security

- Candidate access is the link token alone; there is no candidate login to
  attack.
- Rating bounds are enforced per instrument from the assessment row, so a 5
  submitted against the 0–4 Inventory is rejected at the edge rather than
  clamped — a value outside the range means the client and the server disagree
  about the scale, and absorbing it would hide that.
- Branding is `superadmin`-only, enforced in middleware rather than only by
  hiding the nav item.
- Tokens are opaque and stored only as keyed hashes.
- Admin sessions are HS256 JWTs in an httpOnly, SameSite=Lax cookie, 12 hours.
- Every public body is parsed through a zod schema.
- Fixed-window rate limits on session load, start, answers, submit, report reads
  and admin sign-in.
- CSV exports prefix cells beginning `=`, `+`, `-` or `@` to defuse spreadsheet
  formula injection from candidate-supplied text.
- `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and
  `noindex, nofollow` on every document.
