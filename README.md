# College Attendance Management System

Five roles (Administrator, HOD, Teacher, Student, Mentor), one database, one audit trail.
Node 20 + Fastify + Postgres on the back, React + Vite on the front.

A fresh deployment sets itself up: while no account exists, the site offers to
create the administrator instead of asking you to sign in, and everything after
that is created inside the app. **[GUIDE.md](GUIDE.md)** is the handbook for
everyone who will use it; the same steps are in the app under **Guide**.

## Deploy to Vercel (free tier)

Everything runs in one Vercel project: the React bundle as static files, the
whole API as a single function at `api/index.js`.

```bash
# 1. a free Postgres — Neon or Supabase, via the Vercel Marketplace
#    (Vercel Postgres itself is gone; it was always a door to Neon)
# 2. create the schema and demo data from your machine, using the
#    UNPOOLED connection string
DATABASE_URL="postgres://…neon.tech/attendance?sslmode=require" npm run migrate
DATABASE_URL="postgres://…neon.tech/attendance?sslmode=require" npm run seed

# 3. deploy
vercel --prod
```

Environment variables to set in the Vercel dashboard:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **pooled** string (the `-pooler` host), not the direct one |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `BLOB_READ_WRITE_TOKEN` | injected automatically when you add the Blob integration |
| `DEFAULT_MIN_ATTENDANCE` | optional, defaults to 75 |

Before deploying, you can run the function the way Vercel will:

```bash
npm install && npm run test:vercel    # 9 assertions through a simulated runtime
```

### What the free tier shaped

- **One function, not one per route.** Hobby counts invocations (1M/month) and
  every cold start costs a Fastify boot plus a Postgres connection. Splitting
  routes would multiply cold starts for no benefit.
- **One database connection per instance.** Serverless inverts pooling: a burst
  spawns instances, each wanting connections, and Postgres answers `too many
  clients` at exactly the wrong moment. `PG_POOL_MAX=1` plus the provider's
  pooler is the fix — `allowExitOnIdle` lets a frozen instance let go.
- **Polling pauses on a hidden tab.** Notification and activity feeds refresh
  every two minutes, and stop entirely when nobody is looking. A phone left open
  on a desk all day costs zero invocations.
- **Certificates travel as JSON data URLs.** Vercel's filesystem is read-only
  and its request body caps at 4.5 MB, so uploads are capped at 3 MB and land in
  Vercel Blob (1 GB free) when a token is present, local disk otherwise. One
  code path, two destinations.
- **Login lockout lives in Postgres.** An in-memory counter means nothing when
  every request may hit a different instance.
- **Region pinned to `bom1`.** Put the database in the same region; a dashboard
  doing a handful of queries across an ocean feels broken.

Two things to know before you rely on this: Hobby's terms restrict it to
**non-commercial, personal use**, so if the college pays for this, Hobby is the
wrong plan. And Neon's free tier suspends compute when idle, so the first
request after a quiet spell takes a second or two while it wakes.

Deploying to Vercel free tier: see **[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)**.

**Deploying?** `RUNBOOK.md` is the step-by-step from an empty machine to a live
URL, written so an agent or a person can execute it without asking questions.

## Run it

```bash
# everything at once
cp server/.env.example server/.env        # set JWT_SECRET
docker compose up --build                 # app on http://localhost:8080
```

Local development, two terminals:

```bash
# terminal 1
cd server && npm install && npm run migrate && npm run seed && npm run dev
# terminal 2
cd web && npm install && npm run dev      # http://localhost:5173
```

The seed creates a demo department. Every account uses `password123`:

| Role | Login ID |
|---|---|
| HOD | `hod` |
| Teacher | `ravi` (also has account-creation authority), `meera`, `joseph`, … |
| Mentor | `mentor` |
| Student | `cse-a1` … `cse-a10`, `cse-b1` … `cse-b10` |

`ravi` teaches CSE-B period 3 on every day, which is the quickest way to see the
marking screen with real data.

## Verify it

```bash
export DATABASE_URL="postgres://…"
npm run verify          # everything, from an empty database
```

`scripts/verify-all.sh` migrates, starts the app behind `scripts/vercel-sim.mjs`
(which serves `api/index.js` with `VERCEL=1`, exactly as Vercel calls it), runs
the first-run suite against the still-empty database, seeds, and then runs the
rest — **206 assertions**:

| Suite | What it proves |
|---|---|
| `server/test/bootstrap.mjs` (7) | The first-run endpoint on an empty database: it offers setup, refuses a weak password, survives six simultaneous attempts creating exactly one administrator, and then never opens again |
| `server/test/admin.mjs` (18) | The administrator role: staffing the college, the things an HOD may not do to an administrator, the oversight views, and creating a spare administrator so one lost password is survivable |
| `server/test/e2e.mjs` (83) | Real HTTP against a real database: RBAC rejections, the roster save, the trigger that maintains percentages, leave approval writing `leave` rows, the event credit overriding a teacher's mark, both exports, login rate limiting, and the audit rows each leaves behind |
| `web/test/render.mjs` (50) | Every page for every role, mounted in jsdom against the live API — fails on a thrown render, a React error, or a page stuck loading |
| `web/test/interact.mjs` (13) | The marking screen driven like a teacher: cascading pickers, tap the roster, save, correct a mark, then check the database and audit trail agree |
| `web/test/first-run.mjs` (8) | The empty deployment: one HOD, no data. Checks the overview leads with the setup checklist rather than a blank page. Needs a migrated, unseeded database |
| `web/test/journey.mjs` (35) | The whole story in one mounted app: HOD sets the minimum → teacher marks and corrects → student sees their gap and applies for leave with a certificate → HOD approves and the register updates → mentor creates a club and an event that credits a period → the student joins and the credit overrides the absence → HOD reads the audit trail and exports the students who are behind |

The journey test signs in through the login form and clicks the sidebar, so it
exercises sign-out, role-scoped navigation and every cross-role hand-off the
spec describes, not just the endpoints.

## Layout

```
server/src/
  interface/http/     routes, zod validation, JWT + capability guards
  application/        use cases — one file per area, transactions live here
  domain/             rbac map, the 48-hour policy, percentage maths (no I/O)
  infra/              repositories (SQL), pool, scrypt, file storage, migrations
web/src/
  pages/              one file per sidebar item
  components/         shell, shared bits
  api.js auth.jsx hooks.js nav.js
```

Dependencies point inwards only. `domain/` imports nothing from `infra/`, so the
edit window and the "classes needed" formula are unit-testable without a
database, and swapping local file storage for S3 touches one file.

Two shared functions carry the cross-cutting requirements, called from inside
the same transaction as the change they describe:

- `logActivity()` — every edit, override, credit, approval and export
- `notify()` — every message to a student, teacher or the HOD

## The interface

Grounded in the thing it replaces: a bound attendance register. A ruled sheet,
a gutter down the left for roll numbers, a red margin rule, and a decisive mark
against each name.

- **Type** is Familjen Grotesk throughout, with tabular figures on by default —
  every column of percentages and roll numbers lines up without special casing.
- **Colour** is a pine-slate ink on cool paper, with the four attendance states
  as the only saturated colours in the product. Dark mode is a token swap.
- **Boldness is spent on the register.** Three stamp-like marks per row, the
  whole row washed by its state, a gutter rule down the roll column, and a
  sticky bar showing how far through the class you are. Everything else —
  tables, forms, feeds — stays deliberately quiet.
- **Colour is never the only signal.** Each state carries its letter (P/A/L),
  under-minimum rows carry a red margin rule and heavier type, and the printed
  sheet marks them with an exclamation instead.
- **On a phone** the rail moves to the bottom within thumb reach, and each
  register row reflows so the three marks span the full width at 48px tall —
  sized to be hit while standing in front of a class.
- **Empty is an instruction, not a shrug.** A fresh deployment opens on an
  eight-step setup checklist in dependency order, with the next step linked and
  each one saying why it blocks the others.

## Decisions worth knowing

**Postgres, not MongoDB.** The schema does real work here. `unique (teacher_id,
day_of_week, period_number)` makes double-booking a teacher impossible;
`unique (student_id, class_date, period_number)` makes two truths for one period
impossible. Those are one line each in DDL and a pile of race-prone application
code anywhere else.

**Percentages are denormalised.** `attendance_summary` holds per-student,
per-subject counts, kept in step by a trigger on `attendance_records`. Dashboards
do an indexed lookup instead of counting the fact table, which is what keeps the
student home page fast once a semester of rows has piled up.

**Leave is condoned, not counted.** `percentage = present / (present + absent)`.
Approved leave leaves the denominator, so a student is never punished for a leave
the college approved. `conducted` still shows classes actually held.

**Medical certificates are not public links.** Vercel Blob only serves public
URLs, so the URL itself is treated as the secret: stored on the request, never
returned to a browser, and the bytes served through an endpoint that allows
only the student, their class teacher and the HOD — and writes a
`leave.document_viewed` row each time. Health data about a student should not
sit behind an unguessable link that anyone who gets it can open forever.

**Every "today" is the college's today.** Dates resolve in `COLLEGE_TIMEZONE`,
not the server's zone, so a 9am class in Kolkata is never filed under
yesterday because the function happened to run in UTC.

**Decisions can be undone, and undoing them corrects the register.** Reversing
an approved leave deletes the rows that approval wrote — and only those, so a
teacher's later mark or an event credit survives.

**Overrides are never silent.** When an event credit replaces a teacher's
"absent", the record keeps a sentence explaining it ("credited via … overriding
the teacher's original mark of absent"), the credit row keeps the previous
status, the teacher is notified, and the audit action is
`attendance.credit_override` rather than a plain edit.

**Only the poster's approval credits.** A join request approved by anyone else is
refused server-side, so two approvers cannot double-credit the same period.

**Low footprint, deliberately.** Fastify over Express, raw SQL over an ORM,
scrypt from `node:crypto` over argon2 (no native build), no charting library
(the bars are CSS), pool capped at 8, `--max-old-space-size=256` in the
Dockerfile. The production bundle is 67 KB gzipped, which matters on the phones
students will actually use.

**Tested through the UI, not just the API.** Three real bugs came out of the
suites above rather than out of a bug report: `count(*)` arriving as a string,
`DATE` columns arriving as timezone-shifted `Date` objects, and an untyped SQL
array literal that 500'd the whole event-credit flow.

**Type parsers, not string maths.** `count(*)` is bigint and `DATE` is a
timezone trap; the pool parses the first to a number and keeps the second as a
plain `YYYY-MM-DD` string. Both were live bugs caught by the test suite.

## Business rules, and where they live

| Rule | File |
|---|---|
| 48-hour teacher edit window, HOD override after | `domain/policies/attendance.policy.js` |
| Only the event poster may approve a join request | same |
| Percentage and "classes needed" | `domain/services/attendance.math.js` |
| Who can do what | `domain/rbac.js` |
| Teacher may only mark a period the timetable gives them | `application/attendance.service.js` |
| Leave approval writes `leave` rows and notifies teachers | `application/leave.service.js` |
| Event credit, override flagging, notifications | `application/events.service.js` |

## Known limits

Everything in the original spec is built. What remains are deliberate choices,
not gaps:

- **PDF export is the browser's.** Records has a Print / PDF button and a print
  stylesheet that repeats table headers and flags under-minimum rows without
  colour. A server-side renderer would add a megabyte to a serverless function
  to reproduce what the browser already does. Excel opens the CSV directly.
- **Sharing is the OS share sheet.** On a phone, exporting offers WhatsApp,
  email and the rest through `navigator.share`; on a desktop it downloads. No
  WhatsApp Business account needed.
- **Backups are 24 hours** on Neon's free tier. Attendance gets disputed months
  later — if this becomes the system of record, buy longer retention.
- **One department.** Any HOD account sees every course; there is no
  departmental scoping.
- **Notifications poll every two minutes**, a deliberate trade against the free
  edge-request budget.
- **No password reset email.** An authorised human sets a new password from
  Setup → Accounts, and the account holder is notified.
- **The demo's mock API is a second implementation** of these rules, for the
  clickable link only. Delete `web/demo/` once you stop needing it, or it will
  drift.
