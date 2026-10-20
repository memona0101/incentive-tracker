# Incentive Tracker

Employees log their daily work (date, file, measure, number of patients), see their progress and history, and compete on a live leaderboard. Administrators approve or reject records and manage the team and the list of files. The app tracks patient counts only; no money, rates or incentive amounts are shown anywhere.

There are **no dependencies**. It runs on Node.js ≥ 22.13 using the built-in `node:sqlite` and `http` modules, and the frontend is plain ES modules (no build step).

## Run it

```bash
npm start
```

Then open http://localhost:3000. On first start the app seeds a demo team with about 60 days of history.

| Account | Email | Password |
|---|---|---|
| Admin | admin@incentive.test | demo1234 |
| Employee | maya@incentive.test (also daniel@, sofia@, liam@, amara@, ethan@, priya@, noah@) | demo1234 |

Other commands:

```bash
npm run dev     # restart automatically when files change
npm run reset   # wipe the database and re-seed the demo data
npm test        # unit tests for the calculation logic
```

Environment variables: `PORT` (default 3000), `HOST` (default `127.0.0.1`; use `0.0.0.0` to share on your network), `DB_FILE` sets a custom database path, and `DEMO=0` hides the demo-account shortcuts on the sign-in page.

**Production mode** (`NODE_ENV=production`, or `SEED_DEMO=0`) never creates demo data or example files. On the first start, with an empty database, it creates one administrator from `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` (at least 10 characters), and refuses to start without them. `npm run reset` is disabled in production. `COOKIE_SECURE=1` (or an `X-Forwarded-Proto: https` header from a reverse proxy) marks the sign-in cookie Secure.

## Deploy on the office server

The app runs next to WBT People behind its Caddy at `https://incentive.wbtpk.com`, using `docker-compose.yml`, the `Dockerfile` and the files in `deploy/`. Step-by-step instructions, backups, updates and restores are in **[deploy/DEPLOY.md](deploy/DEPLOY.md)**.

## Features

**Employees**
- **Dashboard:** approved, pending and lifetime patient totals; patients compared with the same point in the previous period; leaderboard rank; workday streak; a daily chart (approved vs pending); a breakdown by measure; recent records.
- **Submit work:** pick a date (today, yesterday, or up to 3 days back), then for each entry pick a **file** from the admin's list, type or pick a **measure** (new measures are added automatically), and enter the number of patients. A running total updates as you type. The same file + measure can only be logged once per date.
- **History:** search and filter by status, measure and date. Pending records can be deleted, rejection reasons are shown, and you can export to CSV.
- **Leaderboard:** a top-3 podium plus the full ranking by approved patients. Shows week, month, last 30 days or last month, with movement arrows and the gap to the next rank.

**Admin**
- **Overview:** the approval queue, approved patients and records, a team trend chart, top performers and a breakdown by measure.
- **Approvals:** a queue sorted oldest first with filters. Approve or reject one record at a time, or use the bulk bar to act on several. Rejections need a reason, with quick-pick options.
- **Team:** add employees, activate or deactivate them, and reset passwords.
- **Files:** add, rename and describe the files employees log against, and hide files that are no longer in use.

**Live updates:** Server-Sent Events push every change to all open sessions. Dashboards, queues and leaderboards refresh on their own. Employees get a toast the moment their records are approved or rejected, and admins get one when new submissions arrive.

## Calculation rules

- Only **approved** records count toward totals and the leaderboard. Pending patients are shown separately.
- The database still has an optional per-measure rate column (default 0) for possible future payout features; it is not shown in the UI, the leaderboard API or CSV exports.
- Leaderboard ties share a rank (1, 2, 2, 4). Period comparisons are like-for-like, e.g. month-to-date is compared with the same days of the previous month.
- An employee can log a given measure only once per date. A rejected record frees that slot so it can be resubmitted.

## Project layout

```
server/server.js   HTTP server, JSON API, SSE, static hosting
server/db.js       SQLite schema, password hashing (scrypt), demo seed
server/calc.js     pure money/date/ranking helpers (+ calc.test.js)
public/            SPA: index.html, css/app.css, js/app.js (router + live), js/lib.js, js/views/*
data/              SQLite database (created on first run)
```

## Production notes

Sessions are HttpOnly, SameSite=Lax cookies, and every write request must be JSON, which blocks simple cross-site form posts. Login attempts are throttled and a strict Content-Security-Policy is sent. Before deploying, put the app behind HTTPS (and add `Secure` to the session cookie), set `DEMO=0`, and replace or remove the seeded demo accounts.
