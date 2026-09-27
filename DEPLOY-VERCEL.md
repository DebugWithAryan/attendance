# Deploying to Vercel (free tier)

Frontend and API both run on Vercel. The database is Neon Postgres, provisioned
through the Vercel Marketplace, and certificates go to Vercel Blob. No card
required for any of it, but the free allowances shape several design choices —
those are listed at the end so you know what to watch.

## One-time setup

**1. Push the repo to GitHub, then import it at vercel.com/new.**
No framework preset; `vercel.json` already sets the build command, the output
directory and the function config.

**2. Add Postgres.** In the project's Storage tab, install **Neon** from the
Marketplace and connect it. Vercel injects `DATABASE_URL` automatically. Pick
the region closest to your students: `sin1` (Singapore) is the nearest Neon
offers to India — there is no Mumbai. Set `regions` in `vercel.json` to the
same one, so the function and the database are not on opposite sides of an
ocean.

Use the **pooled** connection string (the host contains `-pooler`). The app sets
one connection per instance, and the pooler does the real pooling; without it a
busy morning produces `too many clients` errors.

**3. Add Blob storage.** Storage tab → Blob → create a store. Vercel injects
`BLOB_READ_WRITE_TOKEN`. This is where medical certificates land.

**4. Set the remaining environment variables** (Settings → Environment Variables,
Production + Preview):

```
JWT_SECRET      = <openssl rand -hex 32>
NODE_ENV        = production
STORAGE_DRIVER  = blob
```

Optional: `BADGE_THRESHOLD` (default 90) is the percentage that earns a student
the attendance badge. `DEMO_MODE` belongs only on a demo deployment; see below.

`VERCEL=1` is set by the platform, which is what switches the pool to one
connection per instance and turns off local disk storage.

**5. The schema creates itself.** Every production build runs
`scripts/vercel-build.sh`, which migrates the database before building the web
app. It runs once per build, never from the function, and each migration holds
a Postgres advisory lock, so two builds at once queue instead of colliding. It
uses `DATABASE_URL_UNPOOLED` when the Neon integration provides it, and
`DATABASE_URL` otherwise. A failed migration fails the build, and Vercel keeps
serving the previous deployment. Preview builds never touch the database.

Migrations are written so the version still serving keeps working while a new
one builds: they add tables, columns and triggers, and never tighten a
constraint.

To load the sample department instead of starting empty, from your machine:

```bash
export DATABASE_URL="<the unpooled Neon string from Vercel>"
npm run migrate     # safe to repeat; a no-op once the build has run it
npm run seed        # sample department; skip on a real deployment
```

For a real deployment, skip the seed. The first account is created from the
site itself: while the `users` table is empty, the app serves a **Set up this
college** page instead of the sign-in form, which creates the administrator and
signs you straight in. It closes permanently the moment any account exists, and
concurrent attempts are serialised behind an advisory lock, so only one can win.

From there the administrator creates the HOD from **Accounts**, and the HOD
builds the department. Nobody needs a connection string.

Create a second administrator early. The setup page never comes back, so a
single administrator who loses their password would otherwise need
`scripts/create-account.mjs`, which requires the connection string again.

**6. Deploy.** Every push to `main` ships. `https://<project>.vercel.app` serves
the app; `/api/health` should return `{"ok":true,"serverless":true}`.

## A demo deployment for a tech fest

Give the demo its own Vercel project and its own Neon database, never the
college's. Import the same repository a second time, add Neon to it, then:

1. Set `JWT_SECRET`, `NODE_ENV=production` and **`DEMO_MODE=1`** on the demo
   project only. `DEMO_MODE` turns on one-tap sign-in for the demo accounts, so
   on a real deployment it would let anyone in as a demo HOD.
2. Deploy. The production build creates the tables.
3. From your machine, fill it with the demo college:

   ```bash
   export DATABASE_URL="<the demo project's unpooled Neon string>"
   npm run seed:demo           # prints the demo accounts
   ```

   It refuses a database that already has accounts, and `--reset` only wipes
   a database it created itself, so it cannot overwrite real data by mistake.
4. Between sessions, or on the morning of the fest (the history is dated back
   from the day it runs):

   ```bash
   npm run seed:demo -- --reset
   ```

Every demo account uses `demo1234`, and nobody can change, reset or remove
them. Print the QR poster from **Guide** for the stall; it opens `/welcome`.

## The user manual

`web/public/user-manual.html` and `web/public/user-manual.pdf` ship with the
site at `/user-manual.html` and `/user-manual.pdf`, and the sign-in page,
introduction page and Guide link to them. After changing a screen, regenerate
the screenshots and the PDF with the steps at the top of
`scripts/manual/screenshots.mjs`; after changing only the text, run
`node scripts/manual/pdf.mjs`. Both use a headless Chromium.

## How it fits together

```
browser ──► vercel.app ──┬── /api/*  → api/index.js → Fastify → Neon Postgres
                         └── /*      → web/dist (static React bundle)
                                        certificates → Vercel Blob
```

`api/index.js` builds the Fastify app once per warm container and reuses it, so
the route table, JWT plugin and connection pool are set up on a cold start
rather than on every request. Frontend and API share an origin, so there is no
CORS to configure and no preflight request before each call.

## Verify before you trust it

```bash
node scripts/vercel-sim.mjs                              # serves api/index.js the way Vercel calls it, with VERCEL=1
API_BASE=http://127.0.0.1:4001/api node server/test/e2e.mjs    # 83 API assertions
cd web && API_ORIGIN=http://127.0.0.1:4001 npm run test:ui     # 51 pages + 13 interactions + the 35-step journey, real UI in jsdom
```

`npm run verify` runs all of it, and the feature suites, from an empty database.
To rehearse the production build itself:

```bash
VERCEL_ENV=production DATABASE_URL=… sh scripts/vercel-build.sh   # migrates, then builds web/dist
VERCEL_ENV=preview sh scripts/vercel-build.sh                     # builds only
```

All of these pass through this path with `VERCEL=1` set, which is the
closest you can get to the deployed runtime without deploying.

## What the free tier forced

| Limit | What it is | What the code does |
|---|---|---|
| Postgres connections | Each function instance opens its own; Postgres tops out around 100 | `PG_POOL_MAX` defaults to 1 under `VERCEL=1`, idle connections released after 5s, pooled connection string required |
| Neon scale-to-zero | The database suspends when idle, so the first request after a quiet spell wakes it | `statement_timeout` of 15s rather than a fast failure; the UI shows loading states everywhere |
| Neon free storage | 0.5 GB | Attendance rows are narrow; a 1,200-student college generates roughly 40 MB a year. Certificates never go in the database |
| Blob uploads | 1 GB, and only **2,000 uploads a month** | Certificates capped at 2 MB, sent as a data URL in ordinary JSON, and written to a **private** store — the stored reference is a pathname, not a fetchable URL. 2,000/month is the real ceiling — a large college in flu season could reach it |
| Edge requests | 1M a month | Notification polling is 2 minutes, not 45 seconds. At 45s, 100 users over a six-hour day is ~1.4M requests a month on polling alone; at 2 minutes it is nearer 300k |
| Functions per deployment | 12 on Hobby | The whole API is one catch-all function (`api/index.js`), not a file per route. Fewer cold starts and one connection instead of twelve |
| Function duration | 300s on Hobby, but you pay in compute | `vercel.json` caps this function at 30s. Every endpoint is one or two indexed queries; exports come from a single query rather than a loop |
| No persistent process | Nothing can be held in memory between requests | Login rate limiting counts failures in a Postgres table, because an in-memory counter resets on every new instance |
| Function region | One region | `vercel.json` pins `sin1` (Singapore). Neon offers no Mumbai region, and co-locating the function with the database beats being nearer the browser: a page load is one round trip to the function but six from the function to Postgres |

**Two things that are not technical limits but will bite you:**

Vercel's Hobby plan is for non-commercial use under their terms. A college
running this as real infrastructure is arguably commercial, and that is a
conversation with Vercel rather than something the code can solve.

Cold starts are real. After a quiet period the first request pays for both the
function boot and the Neon wake — expect a second or two. During a school day
with steady traffic you will rarely see it.

## If you outgrow it

Nothing here is a rewrite. The same code runs as a container (`docker compose
up`) against any Postgres, which is what `server/Dockerfile` is for. Moving off
Vercel is a DNS change, an env var, and setting `STORAGE_DRIVER=local` or adding
an S3 branch to `server/src/infra/storage/index.js`.
