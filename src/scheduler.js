import cron from 'node-cron';
import * as db from './db.js';
import { sendMessage } from './bot.js';
import { getYesterdayHST, detectDrift, computeTrend, computeWeeklyStats } from './scoring.js';
import * as msg from './messages.js';

const TZ = 'Pacific/Honolulu';

const SUGGESTIONS = {
  SLEEP:  'Set a hard phone-down time 30 min before bed.',
  FOOD:   'Prep meals for your eating windows the night before.',
  WORK:   'Block 90 min tomorrow morning — phone on DND, no Slack.',
  SOCIAL: 'Text one friend today. Plan one real thing.',
  None:   'Keep the streak going. Add one ambitious thing.',
};

export function startScheduler() {
  // Morning Brief — 7:30 AM HST daily
  cron.schedule('30 7 * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;

    const yesterday = db.getDailyLog(getYesterdayHST());
    const logs = db.getRecentLogs(7);
    const trend = computeTrend(logs);
    const drift = detectDrift(logs);
    const driftStr = drift.drifts.length > 0
      ? drift.drifts.map(d => d.area).join(', ')
      : 'None';
    const suggestion = SUGGESTIONS[drift.biggest] || SUGGESTIONS.None;

    const avg7 = logs.length > 0
      ? (logs.reduce((s, r) => s + r.total_score, 0) / logs.length).toFixed(1)
      : 'N/A';

    await sendMessage(chatId, msg.morningBrief({
      yesterday, avg7, trend, driftStr, suggestion,
    }));
  }, { timezone: TZ });

  // Evening Check-in — 9:30 PM HST daily
  cron.schedule('30 21 * * *', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;
    await sendMessage(chatId, msg.eveningPrompt());
  }, { timezone: TZ });

  // Weekly Review — Sunday 9:00 AM HST
  cron.schedule('0 9 * * 0', async () => {
    const chatId = db.getChatId();
    if (!chatId) return;

    const logs = db.getRecentLogs(7);
    const stats = computeWeeklyStats(logs);
    if (!stats) return;

    db.insertWeeklyReview(stats);
    await sendMessage(chatId, msg.weeklyReview(stats));
  }, { timezone: TZ });

  console.log('Scheduler started (timezone: Pacific/Honolulu)');
  console.log('  Morning brief  → 7:30 AM');
  console.log('  Evening prompt → 9:30 PM');
  console.log('  Weekly review  → Sunday 9:00 AM');
}
