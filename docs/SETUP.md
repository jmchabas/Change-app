# Setup Guide

## Prerequisites

- Node.js 20+ installed ([download](https://nodejs.org))
- A Telegram account

## Step 1: Create a Telegram Bot

1. Open Telegram on your phone or desktop
2. Search for **@BotFather** (the official Telegram bot for creating bots)
3. Send: `/newbot`
4. Choose a display name (e.g. `LifeOS`)
5. Choose a username ending in `bot` (e.g. `jm_lifeos_bot`)
6. BotFather will reply with your **bot token** — it looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`
7. Copy this token — you'll need it next

**Optional but recommended:**
- Send `/setdescription` to BotFather → select your bot → enter: `Personal life operating system`
- Send `/setuserpic` to BotFather → upload an icon

## Step 2: Configure

```bash
# In the project root
cp .env.example .env
```

Open `.env` in any editor and replace the placeholder:

```
TELEGRAM_BOT_TOKEN=paste-your-real-token-here
```

## Step 3: Install dependencies

```bash
npm install
```

This installs:
- `grammy` — Telegram bot framework
- `better-sqlite3` — embedded SQLite database
- `express` — web server for the dashboard
- `node-cron` — scheduled message delivery
- `dotenv` — loads .env configuration

## Step 4: Start

For development (auto-restarts on file changes):
```bash
npm run dev
```

For production:
```bash
npm start
```

You should see:
```
Starting LifeOS...
✓ Database ready
✓ Telegram bot running (polling)
Scheduler started (timezone: Pacific/Honolulu)
  Morning brief  → 7:30 AM
  Evening prompt → 9:30 PM
  Weekly review  → Sunday 9:00 AM
✓ Dashboard → http://localhost:3000
```

## Step 5: Activate the bot

1. Open Telegram
2. Search for your bot username (the one you chose in Step 1)
3. Send `/start`
4. The bot responds with a welcome message
5. Log your first day: `7.5 Y Y Y Y N Y`

## Step 6: See the dashboard

Open `http://localhost:3000` in your browser. You'll see your score and metrics.

## Timezone

Everything runs in **Pacific/Honolulu (HST, UTC-10)**. The cron schedules and date calculations use this timezone. To change it:

1. Edit `TZ` in `.env`
2. Update the `TZ` constant in `src/scoring.js` and `src/scheduler.js`

## Deployment (Railway)

To keep the bot running 24/7, deploy to Railway:

1. Push your code to GitHub (already done if you followed the README)
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your LifeOS repo
5. Go to the Variables tab and add:
   - `TELEGRAM_BOT_TOKEN` = your bot token
6. Railway will build and deploy automatically
7. The dashboard URL will be shown in the deployment logs

**Important:** Railway's free tier gives you 500 hours/month. That's enough for ~20 days of always-on. For full coverage, use the Hobby plan ($5/month) or any other VPS.

## Troubleshooting

**Bot doesn't respond:**
- Check that `TELEGRAM_BOT_TOKEN` is correct in `.env`
- Make sure you sent `/start` to the bot
- Check terminal for error messages

**Scores not computing:**
- Run `npm test` to verify the parser works
- Make sure your log message has exactly 7 space-separated values

**Dashboard empty:**
- Log at least one day via Telegram first
- Refresh the page

**Scheduled messages not arriving:**
- Send `/start` to the bot (this registers your chat ID)
- Check that the process is running (the bot needs to stay running for cron jobs)
