Blaaiz Onboarding Dashboard — live site
A single-page dashboard that reads the real "Sales Relationship update" Asana
project live, on every page load, via a Netlify serverless function. Nothing about
the data is hardcoded — refresh the page (or click the Refresh button) and you see
whatever Asana looks like right now.
This site only ever reads the production sheet — it never creates, updates, or
deletes anything on it. The Asana token it uses only needs read access. The one
thing this pipeline does write to is a separate tracking task in an old test project
(see "What still runs on the hourly schedule" below) — never the real sheet.
How it works
`index.html` — the dashboard UI. On load, and every time you click Refresh, it calls
`/.netlify/functions/data` and renders whatever comes back. No Asana credentials ever
reach the browser.
`netlify/functions/data.js` — a serverless function that calls the Asana API
server-side using a token stored as a Netlify environment variable, classifies each
task into a track/stage the same way the dashboard always has, and returns JSON.
`netlify.toml` — tells Netlify where the site and the function live.
One-time setup
1. Push this to GitHub
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
2. Connect the repo to Netlify
Netlify dashboard → Add new site → Import an existing project.
Pick GitHub, authorize if asked, and select this repo.
Build settings: leave the build command empty, publish directory `.` — there's no
build step, it's a static file plus one function. Netlify will pick up
`netlify.toml` automatically.
Click Deploy.
3. Add your Asana token
Get a Personal Access Token from Asana: My Settings → Apps → Manage Developer
Apps → Personal Access Token. Use a token belonging to whoever should have
read access to the sales project (a dedicated service account is best if you have
one).
In Netlify: Site configuration → Environment variables → Add a variable.
Key: `ASANA_TOKEN`
Value: the token from step 1
Scope: all deploy contexts.
Redeploy the site (Netlify → Deploys → Trigger deploy) so the function picks up the
new variable.
That's it — the site is live. Every page load and every Refresh click hits Asana
directly.
Optional environment variables
Only needed if you point this at a different Asana project or state-tracking task:
`ASANA_PROJECT_GID` — defaults to `1213660624168097`, the real "Sales Relationship
update" project. Read-only — never written to.
`ASANA_STATE_TASK_GID` — defaults to `1217362985782724`, the `[SYSTEM] Stage Tracking State` task. This task deliberately lives in a separate, old test/duplicate
project, not in the real sheet — the real sheet must never have anything added to
it, so this tracking data is kept elsewhere on purpose. Its notes store how long each
account has sat in its current stage (Asana's free-text Status field has no built-in
change history). Do not delete that old test project or this task without first
moving the tracking state somewhere else — it's the one piece of infrastructure this
whole pipeline still depends on outside the real project.
The real sheet has two fields both named "Status"
There's a legacy free-text "Status" field and a clean Single-select "Status" dropdown
— both attached to the project, both literally named "Status". `data.js` reads the
dropdown one specifically by its field ID (`STATUS_FIELD_GID` at the top of the file),
not by name, so it doesn't accidentally pick up the messy legacy field. If that
dropdown field is ever recreated (getting a new ID), update `STATUS_FIELD_GID` to match.
What still runs on the hourly schedule, and why
The classification (which track, which stage, which flags) now happens live in
`data.js` on every request — that part no longer depends on the hourly job at all.
The "days in current stage" number is the one exception: Asana's Status field has
no built-in change history, so the only way to know an account just moved into
Compliance Review this morning versus three weeks ago is to keep a separate running
log. The existing hourly scheduled task keeps writing that log to the `[SYSTEM] Stage Tracking State` task's notes (in the old test project, per above) — this site just
reads it. It reads the real sheet to compute each account's current stage, but only
ever writes to that one external tracking task, never to the real sheet. If you ever
retire that scheduled task, "avg days in stage" will keep working but will stop
advancing — which is a much softer failure than the alternative of writing back to the
real sheet on every single page load (which this deliberately never does).
Known data-quality items in the real sheet (not something this code fixes)
A few things showed up when this was first pointed at the real sheet — flagged here so
they're not mistaken for bugs in the dashboard itself:
"Earth and Minerals" appears as two separate tasks in Pipeline, likely a duplicate
entry — the dashboard will show it twice until/unless it's merged in Asana.
A handful of Business-track deals (e.g. Finlogic, Viva Pay, Vector) have their Status
set to "Integration & Testing", which isn't a valid stage for the Business track (only
Platform and Blaaizpay have that step) — these show up flagged in the Flags KPI and
the table rather than being silently misclassified.
The `AM` custom field is empty on every task; the dashboard falls back to each task's
Asana assignee for the "Rep" column instead, which is populated.
Local testing (optional)
If you have the Netlify CLI installed:
```bash
npm install -g netlify-cli
cd netlify-site
netlify dev
```
This runs the function locally at `http://localhost:8888/.netlify/functions/data` —
set `ASANA_TOKEN` in a local `.env` file first (already gitignored).
