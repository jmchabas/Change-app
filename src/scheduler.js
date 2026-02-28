import cron from 'node-cron';
import * as db from './db.js';
import { sendMessage, startCheckinForUser, startTargetSettingForUser } from './bot.js';
import { getTodayHST, getYesterdayHST, getWeekStartHST, computeTrend } from './scoring.js';
import { generateWeeklyReview } from './claude.js';
import { syncRecentFitbitData } from './fitbit.js';
import * as msg from './messages.js';

const TZ = process.env.TZ || 'America/Los_Angeles';

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

  // 6:40 AM (daily) — pull latest Fitbit metrics
  cron.schedule('40 6 * * *', async () => {
    try {
      const result = await syncRecentFitbitData(1);
      if (result?.ok) console.log('Fitbit sync complete');
    } catch (err) {
      console.error('Fitbit sync error:', err.message);
    }
  }, { timezone: TZ });

  // 5:00 PM (daily) — Target setting prompt + gym reminder
  cron.schedule('0 17 * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;
    startTargetSettingForUser(chatId);
    await sendMessage(chatId, msg.targetPrompt());
  }, { timezone: TZ });

  // 8:30 PM (daily) — Evening check-in with Claude
  cron.schedule('30 20 * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;
    await startCheckinForUser(chatId);
  }, { timezone: TZ });

  // 7:00 AM (daily) — Morning brief
  cron.schedule('0 7 * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;

    try {
      await syncRecentFitbitData(1);
    } catch (err) {
      console.error('Morning Fitbit sync error:', err.message);
    }

    const yesterday = db.getDailyLog(getYesterdayHST());
    const wearableYesterday = db.getWearableMetrics(getYesterdayHST());
    const today = getTodayHST();
    const targets = db.getDeliverables(today);
    const logs = db.getRecentLogs(7);
    const trend = computeTrend(logs);
    await sendMessage(chatId, msg.morningBrief({
      yesterday, targets, trend, wearableYesterday,
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
  console.log('  6:40 AM       → Fitbit sync');
  console.log('  7:00 AM       → Morning brief');
  console.log('  5:00 PM       → Target setting + gym reminder');
  console.log('  8:30 PM       → Evening check-in (Claude)');
  console.log('  Sunday 5:00 PM → Weekly coaching review (Claude)');
}
