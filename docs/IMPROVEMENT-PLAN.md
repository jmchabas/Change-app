# LifeOS Improvement Plan

> Generated 2026-02-17 — Living document, updated as we implement.

---

## Phase 1 — Security Hardening ⬅️ START HERE

| # | Issue | Severity | File(s) | Status |
|---|-------|----------|---------|--------|
| 1.1 | All API endpoints completely public — anyone with the Railway URL can read health data, generate check-in tokens, trigger Fitbit sync | Critical | `src/dashboard.js` | ✅ DONE |
| 1.2 | Any Telegram user can hijack the bot via `/start` — overwrites stored `chat_id` | Critical | `src/bot.js:26-28,85` | ✅ DONE |
| 1.3 | No graceful shutdown — SIGTERM from Railway kills mid-write SQLite and mid-flight API calls | High | `src/index.js` | ✅ DONE |
| 1.4 | Stored XSS — `stress_note`, `coaching_text`, targets injected raw via `innerHTML` | High | `public/index.html` | ✅ DONE |
| 1.5 | Base URL spoofable via proxy headers — could hijack Fitbit OAuth redirect | High | `src/dashboard.js:17-19`, `src/index.js:49` | ✅ DONE |
| 1.6 | No CSP header, CDN Chart.js loaded without SRI hash | Medium | `public/index.html:8` | ✅ DONE |
| 1.7 | Fitbit OAuth state not properly invalidated after use | Medium | `src/fitbit.js:281` | ⬜ TODO |
| 1.8 | Check-in form error messages rendered via innerHTML | Low | `public/checkin.html:285,376` | ✅ DONE |

**Fix approach:**
- 1.1 → Add `DASHBOARD_API_KEY` env var + `x-api-key` middleware on all `/api/*` routes
- 1.2 → Pin allowed Telegram user ID via `TELEGRAM_USER_ID` env var, reject all others in middleware
- 1.3 → SIGTERM/SIGINT handler: stop bot, stop crons, close DB, then exit
- 1.4 → Add `esc()` HTML-escaping utility, apply everywhere user data hits `innerHTML`
- 1.5 → Require `APP_BASE_URL` in production, restrict `trust proxy` to `1`
- 1.6 → CSP header added in Express; SRI hash deferred (Chart.js CDN version pin)
- 1.7 → Delete OAuth state after use instead of setting to empty string
- 1.8 → Use `textContent` instead of `innerHTML` for error messages

---

## Phase 2 — Stability & Robustness

| # | Issue | Severity | File(s) | Status |
|---|-------|----------|---------|--------|
| 2.1 | Conversation memory leak — Claude conversations Map never auto-expires | Medium | `src/claude.js:26` | ✅ DONE |
| 2.2 | Claude API response no null safety — empty content array crashes handler | Medium | `src/claude.js:81,131` | ✅ DONE |
| 2.3 | Claude API no retry — single 429/500 kills reflection or weekly review | Medium | `src/claude.js` | ✅ DONE |
| 2.4 | Fitbit token refresh race condition — concurrent syncs double-use refresh token | Medium | `src/fitbit.js:93-108` | ✅ DONE |
| 2.5 | `getWeekStartHST` timezone parsing bug — server-local TZ instead of configured TZ | Medium | `src/scoring.js:27-35` | ✅ DONE |
| 2.6 | Startup repair functions can crash app — no try-catch | Medium | `src/db.js:298-300` | ✅ DONE |
| 2.7 | Function names say "HST" but default TZ is Los Angeles — misleading | Medium | `src/scoring.js:3` | ✅ DONE |
| 2.8 | Stale daily claim keys accumulate in settings forever | Low | `src/db.js` | ✅ DONE |
| 2.9 | `insertBreakLogs` not wrapped in transaction — partial writes possible | Low | `src/db.js` | ✅ DONE |
| 2.10 | `bot.catch` swallows stack traces — only logs `.message` | Low | `src/bot.js:125` | ✅ DONE |
| 2.11 | `/api/history` returns all rows with no pagination | Low | `src/dashboard.js:63` | ✅ DONE |
| 2.12 | `repairHistoricalBedtimeScoring` full-table scan on every startup | Low | `src/db.js` | ✅ DONE |

**Fix approach:**
- 2.1 → Add 2-hour TTL + `createdAt` timestamp to conversation Map entries
- 2.2 → Optional chaining on `response?.content?.[0]?.text` with fallback error
- 2.3 → Retry wrapper with exponential backoff (2 retries, skip non-retryable status codes)
- 2.4 → Mutex/promise dedup around token refresh
- 2.5 → Use explicit UTC parsing (`T00:00:00Z` + `setUTCDate`/`getUTCDay`)
- 2.6 → Wrap each repair function in try-catch, log and continue
- 2.7 → Rename functions to drop "HST" suffix (e.g., `getTodayLocal`)
- 2.8 → Nightly cron to purge `_sent:` keys older than 30 days
- 2.9 → Wrap in `db.transaction()`
- 2.10 → Log `err.error ?? err` for full Grammy error chain
- 2.11 → Add `?limit=` query param, cap at 1000
- 2.12 → Guard with `bedtime_scoring_repaired` setting flag

---

## Phase 3 — Engagement Quick Wins

| # | Feature | Impact | Complexity | Status |
|---|---------|--------|------------|--------|
| 3.1 | Streak computation + display in morning brief ("Clean Eve: day 6") | High | Simple | ⬜ TODO |
| 3.2 | Check-in reminder at 9:30pm if form not submitted | High | Simple | ⬜ TODO |
| 3.3 | Bedtime nudge at 9:15pm ("15 min to bed target") | High | Simple | ⬜ TODO |
| 3.4 | Quick check-in mode — "Good day" button pre-fills all fields | High | Simple | ⬜ TODO |
| 3.5 | Dashboard reorder — Today card + Sleep card on top | High | Simple | ⬜ TODO |
| 3.6 | Mobile tab navigation (Today / Week / Trends / Coaching) | Medium | Simple | ⬜ TODO |
| 3.7 | Trend threshold fix (0.3 → ±5 on 0-100 scale) | Medium | Simple | ⬜ TODO |

---

## Phase 4 — Coaching Upgrade

| # | Feature | Impact | Complexity | Status |
|---|---------|--------|------------|--------|
| 4.1 | Inject 3-day history + streaks into Claude reflection context | High | Medium | ⬜ TODO |
| 4.2 | Extract and store reflection commitments at turn 3-4 | High | Medium | ⬜ TODO |
| 4.3 | Morning brief: add streak callouts, risk flags, commitment recall | High | Medium | ⬜ TODO |
| 4.4 | Reflection closes with action contract — not silent timeout | High | Medium | ⬜ TODO |
| 4.5 | Weekly review: add wearable context + week-over-week deltas | Medium | Simple | ⬜ TODO |
| 4.6 | If-then plan generation in evening reflection | Medium | Complex | ⬜ TODO |
| 4.7 | Morning brief references last night's reflection commitment | Medium | Medium | ⬜ TODO |

---

## Phase 5 — Data Intelligence

| # | Feature | Impact | Complexity | Status |
|---|---------|--------|------------|--------|
| 5.1 | Correlation engine — pairwise analysis (sleep vs score, gym vs mood, etc.) | High | Medium | ⬜ TODO |
| 5.2 | Leading indicator morning pulse (energy, risk, confidence — 15 sec) | High | Medium | ⬜ TODO |
| 5.3 | Support stack analysis — pass coffee/meds/gut data to Claude + show correlations | Medium | Simple | ⬜ TODO |
| 5.4 | Separate mood from behavior in scoring (behavior/80 + state/10) | Medium | Simple | ⬜ TODO |
| 5.5 | Day-of-week performance patterns in weekly review | Low | Simple | ⬜ TODO |

---

## Phase 6 — Dashboard Polish

| # | Feature | Impact | Complexity | Status |
|---|---------|--------|------------|--------|
| 6.1 | Consolidate 8 habit charts into one multi-line "Habit Consistency" chart | Medium | Medium | ⬜ TODO |
| 6.2 | Calendar heatmap (GitHub-style daily score visualization) | Medium | Medium | ⬜ TODO |
| 6.3 | Reference lines on charts (80-pt green zone, bedtime target, 7h sleep min) | Medium | Medium | ⬜ TODO |
| 6.4 | Weekend shading on all charts | Low | Simple | ⬜ TODO |
| 6.5 | Tap data point → tooltip with full day breakdown | Low | Medium | ⬜ TODO |

---

## Future Ideas (Backlog)

- Weekly/monthly goal setting with progress bars
- Exportable weekly summary (PDF/markdown) for therapist or accountability partner
- Apple Health / Garmin integration (DB schema already supports `source` field)
- Midday pulse check (inline Telegram button at 1pm)
- Adaptive protocols (trigger-response rules, e.g., 2 bad days → recovery mode)
- Legacy scoring cleanup (remove `total_score` 0-8 and `mood` 1-5 columns)

---

## Status Legend

- ⬜ TODO
- 🔧 IN PROGRESS
- ✅ DONE
- ⏭️ SKIPPED (with reason)
