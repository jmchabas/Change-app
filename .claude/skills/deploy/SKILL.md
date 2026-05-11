---
name: deploy
description: Deploy Change app (LifeOS) to Railway - commit, push, verify deployment health
disable-model-invocation: true
---

# Deploy Change app to Railway

## Pre-deploy checks

1. Run `npm test` — abort if tests fail
2. Check for uncommitted changes with `git status`
   - If there are changes, ask the user if they want to commit before deploying
3. Verify no `.env` secrets are staged: `git diff --cached --name-only | grep -q '\.env$' && echo "ABORT: .env staged" && exit 1`

## Deploy

1. Push the current branch to origin:
   ```bash
   git push origin main
   ```
2. Railway auto-deploys from the push. Monitor with:
   ```bash
   railway logs --latest
   ```
   If `railway` CLI is not installed, tell the user to check the Railway dashboard.

## Post-deploy verification

1. Check the bot is responsive — remind the user to send a test message to the Telegram bot
2. Check the dashboard is reachable at the APP_BASE_URL from .env.example

## Rollback

If something is wrong:
```bash
git revert HEAD
git push origin main
```
