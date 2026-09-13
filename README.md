# QR Relay Showdown

An 18-team, 6-QR-code live competition. Six fixed QR codes each lock a team
to one of six questions; the first six teams overall to answer correctly
win — there is one global winner count of 6, not six per question. Built
with Node.js, Express, Socket.IO and SQLite.

## How the rules map to the code

- **Fixed QR → question mapping.** `/q/1` .. `/q/6` always serve the same
  question. The mapping is never randomized and never re-derived from
  anything but the `qrId` a team registered with (`server/db.js`,
  `server/routes/player.js`).
- **Server-authoritative question assignment.** A team's `qrId` is written
  once at registration and read from the database on every request — the
  URL a browser happens to be on afterwards is never trusted
  (`server/lib/gameLogic.js: registerTeam`, `submitAnswer`).
- **Max 3 teams per question, 18 teams total, 3 attempts per team, 6
  global winners.** All enforced inside SQLite transactions so two
  simultaneous requests can't both grab the last slot, the last attempt,
  or the 6th winning rank (`server/lib/gameLogic.js`). better-sqlite3 runs
  synchronously, and Node runs one JS statement at a time, so a
  `db.transaction(...)` call is a genuine critical section as long as you
  run a single Node process (see **Scaling note** below).
- **Answers never reach the client.** `/api/qr/:id` and `/api/team/state`
  only ever return question text, never the correct answer. Only the
  admin API (behind login) exposes it.
- **Real-time game-over.** Socket.IO broadcasts `game:started` and
  `game:finished` to every connected browser; clients react by re-fetching
  authoritative state from the REST API rather than trusting the socket
  payload itself.
- **Refresh / reconnect safe.** Each team gets an `httpOnly` session
  cookie at registration. Reloading, or opening the link on a second
  device, re-reads the same team row — attempts and status live on the
  server, not in the browser.

## Local setup

```bash
npm install
cp .env.example .env
# edit .env: set ADMIN_PASSWORD and SESSION_SECRET at minimum
npm start
```

Visit `http://localhost:3000` for the landing page, `/admin` for the
admin dashboard, and `/q/1` through `/q/6` to test the player flow
(these will look wrong on `localhost` for playing at a real event — see
below).

Reset a game between test runs (wipes teams/attempts, keeps questions):

```bash
npm run seed:reset
```

## Deploying for a real event

The app needs a real public HTTPS domain — QR codes obviously can't point
at `localhost`. Any host that runs a persistent Node process works
(Render, Railway, Fly.io, a VPS, etc.). It is **not** a good fit for
plain serverless/edge functions, because:

1. SQLite needs a writable, persistent disk (a mounted volume), and
2. the atomicity guarantees above depend on one long-running process.

### Steps

1. Deploy this repo (or the included `Dockerfile`) to your host.
2. Set environment variables:
   - `PUBLIC_APP_URL=https://your-real-domain.com` (no trailing slash)
   - `ADMIN_PASSWORD=<a real password>`
   - `SESSION_SECRET=<a long random string>`
   - `DATABASE_PATH=/app/data/game.db` (point this at a mounted
     persistent volume — see the Dockerfile's `VOLUME` line)
3. Once deployed, open `https://your-real-domain.com/admin`, log in, and
   the dashboard's **Event overview** card prints the six live QR URLs
   (built from `PUBLIC_APP_URL`) — generate QR codes from those exact
   links with any QR generator.
4. Before the event: edit each of the six questions/answers from the
   dashboard. Editing locks automatically the instant you click **Start
   game**.
5. Have players scan their QR code and register. The dashboard's QR grid
   shows live 0/3 → 3/3 counts per question.
6. Click **Start game** when ready. Every waiting screen flips to its
   question simultaneously; editing locks.
7. Watch **Teams** and **Successful: n/6** live. The moment the 6th
   correct answer lands, the game auto-finishes and every remaining
   player is pushed to a "you lose" screen in real time — nothing to
   click on the admin side.
8. Run `npm run seed:reset` (or the **Reset game** button in the
   dashboard) before reusing the same deployment for a second run.

### Scaling note

This is built for one event run by one Node process against one SQLite
file — plenty for 18 teams. Don't run multiple instances/replicas of the
server behind a load balancer without moving to a real multi-writer
database (e.g. Postgres) and wrapping the same critical sections in a
`SELECT ... FOR UPDATE`/serializable transaction — otherwise the "exactly
6 winners" and "exactly 3 attempts" guarantees can be violated across
processes.

## Project layout

```
server/
  index.js          Express + Socket.IO app, static file serving, /q/:id routing
  db.js             SQLite schema + seed data (game row, 6 default questions)
  auth.js           Admin session (signed JWT cookie)
  lib/gameLogic.js  All atomic game rules live here
  lib/resetGame.js  CLI: npm run seed:reset
  routes/player.js  Registration, team state, answer submission
  routes/admin.js   Login, overview, teams, question editing, start, results
public/
  index.html        Landing page
  player.html/.js   Registration → waiting → question → result (one SPA)
  admin.html/.js    Login → dashboard (SPA)
  css/style.css     Shared styling
```

## Notes

- Answer matching trims whitespace and is case-insensitive
  (`normalizeAnswer` in `gameLogic.js`) — "Gandhinagar", "gandhinagar" and
  "GANDHINAGAR" are all accepted.
- The admin account is a single shared password, not per-user accounts —
  fine for a one-off event; swap `server/auth.js` for something heavier
  if you need audit trails per admin.
