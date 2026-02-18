# LifeOS

A personal operating system that tracks daily habits, computes scores, detects drift, and keeps you accountable — all through Telegram + a dark cockpit dashboard.

## What it does

- **Evening (9:30 PM):** Bot prompts you to log your day (30 seconds)
- **Morning (7:30 AM):** Bot sends yesterday's score, 7-day trend, and drift alerts
- **Sunday (9:00 AM):** Bot sends a weekly review with best/worst days and one fix
- **Dashboard:** Dark-themed web cockpit with live scores, charts, and drift alerts

## Scoring (max 7/day)

| Metric | Points | Category |
|--------|--------|----------|
| Sleep ≥ 7.5 hours | 1 | Energy |
| In bed on time (60-min window) | 1 | Energy |
| Workout done | 1 | Energy |
| Eating windows respected (no grazing) | 1 | Energy |
| Execution Block 1 (90 min, no Slack) | 1 | Execution |
| Execution Block 2 (60 min, no Slack) | 1 | Execution |
| Social/Family anchor | 1 | Life |

**Energy Score** = first 4 (0–4)
**Execution Score** = next 2 (0–2)
**Life Score** = last 1 (0–1)

## Quick start (5 minutes)

### 1. Create a Telegram bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, pick a name (e.g. "LifeOS") and username (e.g. `my_lifeos_bot`)
3. Copy the token it gives you

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and paste your bot token:
```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
```

### 3. Install & run

```bash
npm install
npm run dev
```

### 4. Activate

1. Open your bot on Telegram
2. Send `/start`
3. Log your first day: `7.5 Y Y Y Y N Y`

That's it. The bot will message you at 7:30 AM and 9:30 PM (Hawaii time).
The dashboard is at `http://localhost:3000`.

## Log format

```
<SLEEP_HOURS> <BED Y/N> <WORKOUT Y/N> <EAT Y/N> <BLOCK1 Y/N> <BLOCK2 Y/N> <ANCHOR Y/N>
```

Example: `7.5 Y Y Y Y N Y`
= 7.5h sleep, bed on time, worked out, ate clean, nailed block 1, skipped block 2, had a social anchor.

## Bot commands

| Command | What it does |
|---------|-------------|
| `/start` | Register + show welcome |
| `/today` | Show today's log and score |
| `/week` | Show 7-day summary |
| `/help` | Show log format |

## Drift detection

The system watches for slow decay in 4 areas over the last 7 days:

- **SLEEP** — avg sleep < 7h or ≥ 2 bedtime misses
- **FOOD** — ≥ 2 eating window misses
- **WORK** — ≥ 3 execution block misses (across both blocks)
- **SOCIAL** — ≥ 5 anchor misses

Morning briefs flag the biggest drift and suggest a specific fix.

## Project structure

```
src/
  index.js        — Entry point: starts bot + scheduler + dashboard
  bot.js          — Telegram bot (Grammy framework)
  scheduler.js    — Cron jobs (morning / evening / weekly)
  db.js           — SQLite database + queries
  scoring.js      — Parser, scoring, drift detection, trend
  messages.js     — All message templates
public/
  index.html      — Dark cockpit dashboard (Chart.js)
scripts/
  test-parser.js  — Unit tests for the log parser
```

## Deploy

This runs as a single process. Deploy anywhere that runs Node.js:

**Railway (recommended):**
1. Push to GitHub
2. Go to [railway.app](https://railway.app), connect your repo
3. Add environment variable `TELEGRAM_BOT_TOKEN`
4. Deploy — done

The SQLite database is a single file (`lifeos.db`), automatically created on first run.

## Tech stack

- **Node.js** + Express (web server)
- **Grammy** (Telegram bot framework)
- **better-sqlite3** (embedded database)
- **node-cron** (scheduled messages)
- **Chart.js** (dashboard charts)

Zero external services. No Google API. No n8n. No cloud database. One process, one file.
