import cron from 'node-cron';
import * as db from './db.js';
import { sendMessage, startCheckinForUser, startTargetSettingForUser } from './bot.js';
import { getTodayHST, getYesterdayHST, getWeekStartHST, computeTrend } from './scoring.js';
import { generateWeeklyReview } from './claude.js';
import { syncRecentFitbitData } from './fitbit.js';
import * as msg from './messages.js';

const TZ = process.env.TZ || 'America/Los_Angeles';

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getNowMinutesInTz() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (hour * 60) + minute;
}

async function sendTargetPromptIfNeeded(chatId, date) {
  if (!chatId) return false;
  if (!db.claimDailySetting('targets_prompt_sent', date)) return false;
  try {
    startTargetSettingForUser(chatId);
    await sendMessage(chatId, msg.targetPrompt());
    db.setSetting(`targets_prompt_sent:${date}`, '1');
    return true;
  } catch (err) {
    db.releaseDailyClaim('targets_prompt_sent', date);
    throw err;
  }
}

async function sendCheckinPromptIfNeeded(chatId, date) {
  if (!chatId) return false;
  if (!db.claimDailySetting('checkin_prompt_sent', date)) return false;
  try {
    await startCheckinForUser(chatId);
    db.setSetting(`checkin_prompt_sent:${date}`, '1');
    return true;
  } catch (err) {
    db.releaseDailyClaim('checkin_prompt_sent', date);
    throw err;
  }
}

export function startScheduler() {

  // Startup bootstrap sync so wearable data appears without waiting for the next cron tick.
  setTimeout(async () => {
    try {
      const result = await syncRecentFitbitData(3);
      if (result?.ok) console.log('Fitbit bootstrap sync complete');
    } catch (err) {
      console.error('Fitbit bootstrap sync error:', err.message);
    }
  }, 5000);

  // 6:30 AM (daily) — pull latest Fitbit metrics before morning message
  cron.schedule('30 6 * * *', async () => {
    try {
      const result = await syncRecentFitbitData(1);
      if (result?.ok) console.log('Fitbit sync complete');
    } catch (err) {
      console.error('Fitbit sync error:', err.message);
    }
  }, { timezone: TZ });

  // 4:30 PM (daily) — Target setting prompt + gym reminder
  cron.schedule('30 16 * * *', async () => {
    const chatId = db.getChatId();
    const date = getTodayHST();
    try {
      const sent = await sendTargetPromptIfNeeded(chatId, date);
      if (sent) console.log('Target prompt sent');
    } catch (err) {
      console.error('Target prompt error:', err.message);
    }
  }, { timezone: TZ });

  // 8:00 PM (daily) — Evening check-in with Claude
  cron.schedule('0 20 * * *', async () => {
    const chatId = db.getChatId();
    const date = getTodayHST();
    try {
      const sent = await sendCheckinPromptIfNeeded(chatId, date);
      if (sent) console.log('Evening check-in prompt sent');
    } catch (err) {
      console.error('Evening check-in prompt error:', err.message);
    }
  }, { timezone: TZ });

  // Every 10 min — catch-up sender for missed scheduled prompts (deploy/restart windows).
  cron.schedule('*/10 * * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;
    const today = getTodayHST();
    const mins = getNowMinutesInTz();
    try {
      // Target prompt catch-up window: 4:30 PM -> 6:00 PM
      if (mins >= (16 * 60 + 30) && mins <= (18 * 60)) {
        const sent = await sendTargetPromptIfNeeded(chatId, today);
        if (sent) console.log('Catch-up: target prompt sent');
      }
      // Check-in prompt catch-up window: 8:00 PM -> 10:00 PM
      if (mins >= (20 * 60) && mins <= (22 * 60)) {
        const sent = await sendCheckinPromptIfNeeded(chatId, today);
        if (sent) console.log('Catch-up: check-in prompt sent');
      }
    } catch (err) {
      console.error('Prompt catch-up error:', err.message);
    }
  }, { timezone: TZ });

  // 7:20 AM (daily) — Morning brief
  cron.schedule('20 7 * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;

    try {
      await syncRecentFitbitData(1);
    } catch (err) {
      console.error('Morning Fitbit sync error:', err.message);
    }

    const today = getTodayHST();
    const yesterdayDate = getYesterdayHST();
    const prevDate = shiftDate(yesterdayDate, -1);
    const yesterday = db.getDailyLog(yesterdayDate);
    const previousDay = db.getDailyLog(prevDate);
    const wearableToday = db.getWearableMetrics(today);
    const wearableYesterday = db.getWearableMetrics(yesterdayDate);
    const wearable = wearableToday || wearableYesterday;
    const recentWearables = db.getRecentWearableMetrics(7).filter((w) => w?.resting_hr != null);
    const rhrCurrent = recentWearables[0]?.resting_hr ?? null;
    const rhrPrevious = recentWearables[1]?.resting_hr ?? null;
    const targets = db.getDeliverables(today);
    const logs = db.getRecentLogs(7);
    const trend = computeTrend(logs);
    await sendMessage(chatId, msg.morningBrief({
      yesterday, previousDay, targets, trend, wearable, rhrCurrent, rhrPrevious,
    }));
  }, { timezone: TZ });

  // 5:00 PM Sunday — Weekly coaching review (Claude)
  cron.schedule('0 17 * * 0', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;

    const logs = db.getRecentLogs(7);
    if (logs.length === 0) return;

    const breakLogs = db.getBreakLogs(7);
    const moodLogs = logs.filter((l) => l.mood_1_10 != null);
    const avgMood = moodLogs.length > 0
      ? (moodLogs.reduce((s, l) => s + l.mood_1_10, 0) / moodLogs.length).toFixed(1)
      : null;
    const avgScore = (logs.reduce((s, l) => s + (l.daily_score ?? l.total_score ?? 0), 0) / logs.length).toFixed(1);

    try {
      const coachingText = await generateWeeklyReview({ logs, breakLogs, avgMood });
      db.insertWeeklyReview({
        week_start: getWeekStartHST(),
        avg_score: parseFloat(avgScore),
        avg_mood: avgMood ? parseFloat(avgMood) : null,
        coaching_text: coachingText,
      });
      await sendMessage(chatId,
        `${msg.weeklyReviewIntro()}\nAvg: ${avgScore}/100  ·  Mood: ${avgMood ?? '?'}/10\n\n${coachingText}`
      );
    } catch (err) {
      console.error('Weekly review error:', err.message);
    }
  }, { timezone: TZ });

  console.log(`Scheduler started (${TZ})`);
  console.log('  6:30 AM       → Fitbit sync');
  console.log('  7:20 AM       → Morning brief');
  console.log('  4:30 PM       → Target setting + gym reminder');
  console.log('  8:00 PM       → Evening check-in (Claude)');
  console.log('  Sunday 5:00 PM → Weekly coaching review (Claude)');
}
