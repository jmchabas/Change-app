# LifeOS

A personal operating system that tracks daily habits, computes scores, detects drift, and keeps you accountable — all through Telegram + a dark cockpit dashboard.

## What it does

- **5:00 PM:** Prompts tomorrow's work + personal targets
- **8:30 PM:** Sends a secure check-in form link
- **After form submit:** Starts short Claude reflection in Telegram
- **7:00 AM:** Sends morning brief with yesterday score + wearables snapshot
- **Sunday 5:00 PM:** Sends weekly coaching review
- **Dashboard:** Dark-themed cockpit with scores, trends, and integrations

## Scoring (0–100/day)

- **Behavior Score (0–80):**
  - escape media minutes
  - meals outside windows
  - clean evening
  - work win
  - personal win
  - gym
  - kids quality
  - time in bed vs 9:30pm target
- **State Score (0–20):**
  - mood slider (1–10)

The app also keeps a legacy 0–8 pass score internally for compatibility.

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
3. Wait for your 8:30 PM check-in link (or open the dashboard and use the check-in flow)

That's it. The bot will message you at 7:30 AM and 9:30 PM (Hawaii time).
The dashboard is at `http://localhost:3000`.

### 5. (Optional) Connect Fitbit for auto-sync

1. Create a Fitbit app at https://dev.fitbit.com/apps
2. Set OAuth 2.0 redirect URL:
   - Local: `http://localhost:3000/auth/fitbit/callback`
   - Railway: `https://<your-app>.up.railway.app/auth/fitbit/callback`
3. Add env vars:
   - `FITBIT_CLIENT_ID`
   - `FITBIT_CLIENT_SECRET`
   - `APP_BASE_URL` (required on deploy, e.g. Railway URL)
4. Open dashboard and click **Connect Fitbit**.

After connection, LifeOS syncs recent Fitbit data daily and shows:
- sleep hours
- sleep score
- resting heart rate

## Check-in fields

- escape media minutes
- meals outside windows
- clean evening + (if no) substances used
- work win achieved?
- personal win achieved?
- gym + type
- kids quality + note
- time in bed (`9.25pm` or `9:25pm`)
- mood slider (1–10)

## Bot commands

| Command | What it does |
|---------|-------------|
| `/start` | Register + show welcome |
| `/today` | Show today's log and score |
| `/week` | Show 7-day summary |
| `/targets` | Set tomorrow targets manually |
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
3. Add environment variables:
   - `TELEGRAM_BOT_TOKEN`
   - `ANTHROPIC_API_KEY`
   - `TZ` (valid IANA timezone, e.g. `Pacific/Honolulu`)
   - `DATABASE_PATH=/data/lifeos.db` (if using volume)
   - `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, `APP_BASE_URL` (optional Fitbit sync)
4. Deploy — done

The SQLite database is a single file (`lifeos.db`), automatically created on first run.

## Tech stack

- **Node.js** + Express (web server)
- **Grammy** (Telegram bot framework)
- **better-sqlite3** (embedded database)
- **node-cron** (scheduled messages)
- **Chart.js** (dashboard charts)

Zero external services. No Google API. No n8n. No cloud database. One process, one file.
