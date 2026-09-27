# Deployment runbook — College Attendance System

**Read this whole file before running anything.**

This is written for an AI agent with shell access and a browser on the owner's
machine. A human can follow it too. It takes the repo from a folder on disk to a
live URL on Vercel's free tier, with a real Postgres behind it.

Expect 30–45 minutes, most of it waiting on dashboards.

---

## Rules for the agent

1. **Work phase by phase.** Each phase ends with a verification command and an
   expected result. If the result does not match, stop and report — do not
   continue and do not improvise a fix to a step you were told to verify.
2. **Never enter payment details.** Every service here has a free tier. If any
   screen asks for a card, stop and ask the owner.
3. **Never type the owner's passwords.** Sign-in to GitHub, Vercel and Neon is
   the owner's job. Open the page, then hand the keyboard over and wait.
4. **Never commit secrets.** `.env` is gitignored. Connection strings and tokens
   go into the Vercel dashboard or `vercel env add`, never into a file that git
   tracks, and never pasted into a chat log.
5. **Announce before anything irreversible** — pushing to a public repo,
   deploying to production, running a migration against a database that already
   holds real data.
6. **Report in this format** after each phase:
   `PHASE n: done | blocked — <one line> — <what you need from the owner>`

---

## Phase 0 — Check the machine

```bash
node --version      # need v20 or later
git --version
npm --version
psql --version      # optional; only used for manual inspection
```

If Node is older than 20, stop. Install Node 20+ first (`nvm install 20`).

```bash
cd <the folder you unzipped>
ls
# expect: api/  scripts/  server/  web/  vercel.json  package.json  README.md  DEPLOY-VERCEL.md  RUNBOOK.md
```

**Verify all of those exist.** If `api/`, `vercel.json` or `web/package.json`
is missing, the code is not here — you are either in the wrong folder or
looking at an empty scaffold with the same name. Do not try to build the
missing parts. Stop and ask the owner for `besc-attendance.zip`.

A scaffold created separately (a bare `package.json`, a `server/src/config/`
with a different filename, empty folders) is not a partial copy of this
project and cannot be merged with it. Replace it wholesale:

```bash
# from inside the empty scaffold's parent directory
mv "BESC Project" "BESC Project.old"     # keep it until you are sure
unzip besc-attendance.zip                # creates attendance/
mv attendance "BESC Project"
cd "BESC Project"
```

A quick integrity check — these five files are the ones everything else hangs
off, and all five must be present:

```bash
for f in api/index.js vercel.json web/package.json \
         server/src/app.js server/src/infra/db/migrations/001_init.sql; do
  [ -f "$f" ] && echo "ok   $f" || echo "MISSING $f"
done
```

---

## Phase 1 — Prove it works locally, before Vercel is involved

Do not skip this. If something is broken, finding out here costs minutes;
finding out after deployment costs an afternoon.

You need a local Postgres. Either is fine:

```bash
# Option A — Docker
docker run -d --name attendance-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=attendance -p 5432:5432 postgres:16-alpine

# Option B — an existing local Postgres; create the database
createdb attendance
```

Then:

```bash
npm install
npm --prefix web install

export DATABASE_URL="postgres://postgres:postgres@localhost:5432/attendance"
export JWT_SECRET="$(openssl rand -hex 32)"

npm run verify
```

**Expected, and nothing less:**

```
--- schema
--- serverless entry on :4001
{"ok":true,"env":"development","serverless":true}
--- API suite
64 passed, 0 failed
--- UI suites
33 pages rendered, 0 failed
13 passed, 0 failed
30 passed, 0 failed
--- all suites passed
```

**If any suite fails, stop here and report the failing assertion.** Do not
deploy a failing build.

Optional but worth 5 minutes — look at it in a real browser:

```bash
# terminal 1
npm --prefix server run dev        # API on :4000
# terminal 2
npm --prefix web run dev           # UI on :5173
```

Open http://localhost:5173 and sign in as `hod` / `password123`.

---

## Phase 2 — Get the code on GitHub

Vercel deploys from a git repo. If the owner already has one, skip to Phase 3.

```bash
git init
git add -A
git status --short          # confirm no .env, no node_modules, no dist
git commit -m "College attendance system"
```

**Verify:** `git status --short` before committing shows no `.env` and no
`node_modules`. If it does, stop — `.gitignore` is not being applied.

Then, in the browser: go to https://github.com/new, create a **private** repo
named `attendance`, do not add a README or .gitignore. Copy the remote URL it
shows.

```bash
git remote add origin <the URL GitHub showed>
git branch -M main
git push -u origin main
```

**Verify:** refresh the GitHub page; the files are there.

---

## Phase 3 — Create the Vercel project

Browser: https://vercel.com/new

1. Sign in with GitHub. **Hand the keyboard to the owner for this.**
2. Find the `attendance` repo, click **Import**.
3. On the configure screen:
   - Framework Preset: **Other** (leave it alone — `vercel.json` already sets
     the build command, output directory and function config)
   - Root Directory: `./`
   - Do **not** add environment variables yet
4. Click **Deploy**.

This first deploy **will build but the API will fail**, because there is no
database yet. That is expected. Let it finish.

**Verify:** the deployment completes and the URL loads the login screen.
Signing in fails — correct at this stage.

---

## Phase 4 — Add Postgres (Neon, free tier)

Browser, in the new project: **Storage** tab → **Create Database** →
**Neon** → Continue.

- Plan: **Free**. If it asks for a card, stop and ask the owner.
- Region: **Singapore** or **Mumbai** for an Indian college. Whatever you pick,
  Phase 6 pins the function to the same region — they must match, or every page
  pays a round trip across an ocean.
- Click Create, then **Connect** it to this project.

Vercel injects several variables automatically. Confirm in **Settings →
Environment Variables** that `DATABASE_URL` now exists.

**Critical:** the app must use the **pooled** connection string. Open the Neon
tab and look at the value — the host should contain `-pooler`. If `DATABASE_URL`
points at the unpooled host, copy the pooled one and set it as
`DATABASE_URL_POOLED` (the app prefers that name).

Why this matters: every function instance opens its own connection. Without the
pooler, a Monday morning login rush produces `too many clients` errors at
exactly the moment everyone needs it.

**Verify:** `DATABASE_URL` (or `DATABASE_URL_POOLED`) exists and contains
`-pooler`.

---

## Phase 5 — Add Blob storage (for medical certificates)

Storage tab → **Create** → **Blob** → name it `certificates` → Create → Connect
to the project.

**Verify:** `BLOB_READ_WRITE_TOKEN` appears in Settings → Environment Variables.

Skipping this is allowed — everything works except certificate uploads, which
fail with a clear message. Vercel's filesystem is ephemeral, so there is no
local-disk fallback in production.

Note how certificates are protected: Vercel Blob only issues public URLs, so
that URL is treated as the secret. It is stored on the leave request, never
sent to a browser, and the bytes reach the class teacher and HOD through
`GET /api/leave/:id/document`, which checks who is asking and writes a
`leave.document_viewed` row. Do not "simplify" this into a plain link — these
are medical documents about students.

---

## Phase 6 — Set the remaining environment variables

Settings → Environment Variables. Add each to **Production, Preview and
Development**:

| Name | Value |
|---|---|
| `JWT_SECRET` | output of `openssl rand -hex 32` — 64 hex characters |
| `NODE_ENV` | `production` |
| `STORAGE_DRIVER` | `blob` |
| `COLLEGE_TIMEZONE` | `Asia/Kolkata` (or the college's zone) |

Or from the CLI:

```bash
npm i -g vercel
vercel login          # hand the keyboard to the owner
vercel link           # select the existing project
vercel env add JWT_SECRET production
```

`COLLEGE_TIMEZONE` matters more than it looks: without it the server resolves
"today" in UTC, and anyone marking attendance before 05:30 IST would be writing
to yesterday's date.

Do not set `VERCEL` — the platform sets it, and that flag is what switches the
pool to one connection per instance and turns off local disk storage.

Check the region: `vercel.json` pins `regions: ["bom1"]` (Mumbai). If the
database went somewhere else, edit that line to match — `sin1` for Singapore —
and commit the change.

**Verify:**

```bash
vercel env ls
# JWT_SECRET, NODE_ENV, STORAGE_DRIVER, DATABASE_URL, BLOB_READ_WRITE_TOKEN
```

---

## Phase 7 — Create the schema and the first real account

Migrations run **from the owner's machine**, never from the deployed function. A
deploy hook that migrates concurrently across instances is a good way to corrupt
a schema.

Get the connection string:

```bash
vercel env pull .env.production.local
# this file is gitignored; confirm with: git check-ignore .env.production.local
```

Then run the migration against the live database:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"')"
node server/src/infra/db/migrate.js
```

**Expected:**

```
applied 001_init.sql
applied 002_triggers.sql
applied 003_login_attempts.sql
applied 004_private_documents.sql
migrations up to date
```

Now create the one account the system starts with. **No demo data** — this is a
real deployment, so the database stays empty apart from a single HOD who builds
the department through the Setup page (Phase 11).

Do **not** run `server/src/infra/db/seed.js`. It exists for throwaway preview
deployments only, and every account it creates shares the password
`password123`.

Ask the owner for the HOD password — at least 12 characters. Do not invent one,
do not reuse an example from this file, and do not echo it back in the
transcript.

```bash
node -e "
const run = async () => {
  const { hashPassword } = await import('./server/src/infra/security/password.js');
  const { pool } = await import('./server/src/infra/db/pool.js');
  const password = process.argv[1];
  if (!password || password.length < 12) throw new Error('pass a password of 12+ characters');
  await pool.query(
    \"insert into users (name, login_id, password_hash, role) values (\$1, \$2, \$3, 'hod')\",
    [process.argv[2] || 'Head of Department', 'hod', await hashPassword(password)]
  );
  await pool.end();
  console.log('HOD created — login id: hod');
};
run().catch((e) => { console.error(e.message); process.exit(1); });
" 'THE-PASSWORD-THE-OWNER-GAVE-YOU' 'Their Full Name'
```

**Verify:**

```bash
node -e "
import('./server/src/infra/db/pool.js').then(async ({ pool }) => {
  const r = await pool.query('select role, count(*) from users group by role');
  console.table(r.rows);
  await pool.end();
});
"
```

---

## Phase 8 — Deploy for real

```bash
git add -A
git commit -m "Region and config for deployment" || echo "nothing to commit"
git push
```

The push triggers a deployment. Or force one:

```bash
vercel --prod
```

**Verify:** the build log ends with `Build Completed`, and:

```bash
curl -s https://<project>.vercel.app/api/health
# {"ok":true,"env":"production","serverless":true}
```

If this returns `The API failed to start`, go to the Troubleshooting table.

---

## Phase 9 — Smoke test the live site

The production database holds one HOD and nothing else, so **do not run the
journey suite against it**. That suite creates clubs, events, attendance and
leave requests; it belongs against a local or preview database, where Phase 1
already ran it.

What to check on the live URL instead:

```bash
curl -s https://<project>.vercel.app/api/health
# {"ok":true,"env":"production","serverless":true}
```

Then in Chrome:

1. Sign in as `hod` with the password from Phase 7. **It must work on the first
   try** — if it does not, the account was created against a different database
   than the one the deployment uses.
2. Expect empty states everywhere: no courses, no students, no activity. That is
   correct for a fresh deployment, not a bug.
3. The overview should open on **"Finish setting up the department"** — an
   eight-step checklist with the first step marked as next. That is the
   empty-deployment state working correctly. You can check it automatically:

   ```bash
   cd web && API_ORIGIN=https://<project>.vercel.app HOD_PASSWORD='…' npm run test:first-run
   ```

4. Go to **Activities**. It should show one row — the HOD account being created.
   That single row proves the audit trail is writing to the live database.
5. Sign out and try a wrong password. It should be refused with
   "That login ID and password do not match." Repeat it nine times: the ninth
   should return "Too many failed attempts" — the lockout counts in Postgres,
   so it works across serverless instances.

If all five hold, the deployment is live and wired correctly. Everything else
gets exercised in Phase 11, when the HOD puts real data in.

## Phase 10 — Before anyone real uses it

- [ ] The HOD has signed in and changed their password from Profile.
- [ ] No account anywhere uses `password123`. Run the check below; it must
      return zero rows.
- [ ] The owner knows that every account they create gets its password set by
      them at creation, and that there is no password-reset email — the HOD
      resets a forgotten password by removing and recreating the account.
- [ ] Tell the owner the Hobby plan is for non-commercial use under Vercel's
      terms. A college running this as real infrastructure is arguably
      commercial. That is a conversation with Vercel, not something the code
      solves.

```bash
# any account still on the demo password? expect an empty result
node -e "
import('./server/src/infra/db/pool.js').then(async ({ pool }) => {
  const { verifyPassword } = await import('./server/src/infra/security/password.js');
  const { rows } = await pool.query(\"select login_id, password_hash from users where status='active'\");
  const weak = [];
  for (const r of rows) if (await verifyPassword('password123', r.password_hash)) weak.push(r.login_id);
  console.log(weak.length ? 'WEAK PASSWORDS: ' + weak.join(', ') : 'no demo passwords in use');
  await pool.end();
});
"
```

## Phase 11 — First-run setup, with the HOD present

An empty deployment is not yet usable: nobody can mark attendance until a
timetable exists. This is the owner's data, so **sit with the HOD and enter it
together** — do not invent course or subject names.

The order matters. Each step depends on the one before it.

| # | In the app | Why it has to come first |
|---|---|---|
| 1 | Setup → **Course** | Everything else hangs off a course |
| 2 | Setup → **Sections** (e.g. CSE-A, CSE-B) | Students and timetables belong to a section |
| 3 | Setup → **Subjects** | The timetable assigns a subject to each period |
| 4 | Setup → Accounts → **Teachers** | The timetable assigns a teacher to each period, so they must exist before step 6 |
| 5 | Setup → **Allocation**: one class teacher per section | Leave requests route to the class teacher. Skip this and only the HOD sees them |
| 6 | Schedule → pick the course → **fill the grid** | Six days, up to 8 periods. A teacher cannot hold two sections in the same day-and-period — the server rejects it, which is the check working, not an error |
| 7 | Setup → **Minimum attendance %** per course | Without it, every course silently falls back to 75% |
| 8 | Setup → Accounts → **Students** | One at a time, or **Bulk import** — pick the course and section in the form, then paste `roll_number,name,login_id,password`, one student per line. Rejected rows come back with line numbers; fix and paste again. Roll numbers are unique inside a section, login IDs across the college |
| 9 | Setup → Accounts → **Mentors**, if the college runs clubs | Only mentors can create clubs and credit-bearing events |

Tick these off before handing the URL to staff:

- [ ] Every section has a class teacher
- [ ] Every section's timetable grid is filled for all six days
- [ ] Each course has an explicit minimum percentage
- [ ] One teacher has signed in and can see their own classes highlighted on the
      Schedule page, and can load a roster on the Attendance page
- [ ] One student has signed in and sees their section's timetable

**The real test:** have a teacher mark one genuine class. If the roster loads
and saves, every dependency above is correct. If it says "The timetable has no
class in that period for this section," step 6 is incomplete for that section.

A note on scale: use the bulk import for anything past a handful. Export the
college's student list to CSV with those four columns, paste it in, and check
the rejected rows. Give each student a different initial password — the import
refuses anything under 8 characters, but it cannot stop you pasting the same
one 300 times.

If a student forgets their password, the HOD or an authorised teacher uses
**set password** on their row in Setup → Accounts. There is no reset email
anywhere in this system, and deleting the account would take their attendance
history with it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` returns `The API failed to start` | `DATABASE_URL` or `JWT_SECRET` missing in Production | Check `vercel env ls`, add, redeploy |
| `JWT_SECRET is required in production` in the logs | Variable not set for the Production environment specifically | Re-add it with Production ticked |
| `too many clients already` | Unpooled connection string | Use the `-pooler` host; set it as `DATABASE_URL_POOLED` |
| `relation "users" does not exist` | Migrations never ran against this database | Phase 7 |
| Login works, every other call 401s | Two deployments with different `JWT_SECRET`s | Set it once, redeploy both |
| Certificate upload fails | No `BLOB_READ_WRITE_TOKEN`, or `STORAGE_DRIVER` is not `blob` | Phase 5 and 6 |
| Deep links like `/records` 404 on refresh | `vercel.json` rewrites were edited | Restore the `/((?!api/).*) → /index.html` rewrite |
| First request of the morning takes ~3s | Neon scale-to-zero plus cold start, free tier | Expected. Paid Neon removes the suspend |
| Everything is slow all day | Function region and database region differ | Match `regions` in `vercel.json` to the Neon region |

Logs: `vercel logs <deployment-url>` or the Vercel dashboard → Logs tab.

---

## Rollback

```bash
vercel rollback          # previous deployment becomes production
```

The database is not touched by a rollback. A migration is not reversible here —
if one goes wrong, restore from Neon's point-in-time recovery (Neon dashboard →
Restore), which the free tier keeps for 24 hours.

---

## What to report when finished

```
Live URL:        https://<project>.vercel.app
Health check:    {"ok":true,"env":"production","serverless":true}
Database:        Neon <region>, pooled, N tables, M users
Blob:            connected / skipped
Journey suite:   30 passed / not run (real data)
HOD login id:    hod
Outstanding:     <anything from Phase 10 still unticked>
```

---

## Things to hand back to the owner rather than decide alone

- Which region the database goes in
- The HOD password
- The course, section and subject names in Phase 11 — these are the owner's, not
  yours to invent
- Anything that asks for a payment method
- Any test that fails in Phase 1
