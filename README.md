# Blaaiz Onboarding Dashboard — live site

A single-page dashboard that reads the "Duplicate of Sales Relationship update" Asana
project **live, on every page load**, via a Netlify serverless function. Nothing about
the data is hardcoded — refresh the page (or click the Refresh button) and you see
whatever Asana looks like right now.

## How it works

- `index.html` — the dashboard UI. On load, and every time you click Refresh, it calls
  `/.netlify/functions/data` and renders whatever comes back. No Asana credentials ever
  reach the browser.
- `netlify/functions/data.js` — a serverless function that calls the Asana API
  server-side using a token stored as a Netlify environment variable, classifies each
  task into a track/stage the same way the dashboard always has, and returns JSON.
- `netlify.toml` — tells Netlify where the site and the function live.

## One-time setup

### 1. Push this to GitHub

```bash
cd netlify-site
git init
git add .
git commit -m "Initial live dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(If you don't have a repo yet: create an empty one on GitHub first — no README/license,
so there's nothing to merge — then run the commands above.)

### 2. Connect the repo to Netlify

1. Netlify dashboard → **Add new site → Import an existing project**.
2. Pick GitHub, authorize if asked, and select this repo.
3. Build settings: leave the build command **empty**, publish directory `.` — there's no
   build step, it's a static file plus one function. Netlify will pick up
   `netlify.toml` automatically.
4. Click **Deploy**.

### 3. Add your Asana token

1. Get a Personal Access Token from Asana: **My Settings → Apps → Manage Developer
   Apps → Personal Access Token**. Use a token belonging to whoever should have
   read access to the sales project (a dedicated service account is best if you have
   one).
2. In Netlify: **Site configuration → Environment variables → Add a variable**.
   - Key: `ASANA_TOKEN`
   - Value: the token from step 1
   - Scope: all deploy contexts.
3. Redeploy the site (Netlify → Deploys → Trigger deploy) so the function picks up the
   new variable.

That's it — the site is live. Every page load and every Refresh click hits Asana
directly.

### Optional environment variables

Only needed if you point this at a different Asana project or state-tracking task:

- `ASANA_PROJECT_GID` — defaults to `1217359825300808` (the current sales sheet).
- `ASANA_STATE_TASK_GID` — defaults to `1217362985782724`, the `[SYSTEM] Stage
  Tracking State` task. This task's notes store how long each account has sat in its
  current stage (Asana's free-text Status field has no built-in change history). The
  existing hourly scheduled job keeps that state fresh; this site only reads it.

## What still runs on the hourly schedule, and why

The **classification** (which track, which stage, which flags) now happens live in
`data.js` on every request — that part no longer depends on the hourly job at all.

The **"days in current stage"** number is the one exception: Asana's Status field is
plain text with no change history, so the only way to know an account *just* moved
into Compliance Review this morning versus three weeks ago is to keep a separate
running log. The existing hourly scheduled task keeps writing that log to the
`[SYSTEM] Stage Tracking State` task's notes; this site just reads it. If you ever
retire that scheduled task, "avg days in stage" will keep working but will stop
advancing — which is a much softer failure than the alternative of overwriting it from
every single page load (that would risk lost updates if two people load the page at
once).

## Local testing (optional)

If you have the Netlify CLI installed:

```bash
npm install -g netlify-cli
cd netlify-site
netlify dev
```

This runs the function locally at `http://localhost:8888/.netlify/functions/data` —
set `ASANA_TOKEN` in a local `.env` file first (already gitignored).
