import { Bot } from 'grammy';
import * as db from './db.js';
import { getTodayHST, getTomorrowHST, getYesterdayHST } from './scoring.js';
import * as msg from './messages.js';
import { startCheckin, hasActiveConversation, continueCheckin, clearConversation } from './claude.js';
import { createCheckinToken } from './checkin-link.js';
import { syncRecentFitbitData } from './fitbit.js';

let bot;

const TARGET_FLOW_TTL_MS = 4 * 60 * 60 * 1000;
const PENDING_KEY = 'pending_targets';

function getPendingTargets(chatId) {
  const raw = db.getSetting(`${PENDING_KEY}:${Number(chatId)}`);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    if (state.expiresAt && Date.now() > state.expiresAt) {
      db.deleteSetting(`${PENDING_KEY}:${Number(chatId)}`);
      return null;
    }
    return state;
  } catch { return null; }
}

function setPendingTargets(chatId) {
  db.setSetting(`${PENDING_KEY}:${Number(chatId)}`, JSON.stringify({
    type: 'targets_work',
    workTarget: '',
    expiresAt: Date.now() + TARGET_FLOW_TTL_MS,
  }));
}

function updatePendingTargets(chatId, update) {
  const state = getPendingTargets(chatId);
  if (!state) return;
  Object.assign(state, update);
  state.expiresAt = Date.now() + TARGET_FLOW_TTL_MS;
  db.setSetting(`${PENDING_KEY}:${Number(chatId)}`, JSON.stringify(state));
}

export function clearPendingTargets(chatId) {
  db.deleteSetting(`${PENDING_KEY}:${Number(chatId)}`);
}

export function createBot(token) {
  bot = new Bot(token);

  const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID;
  if (ALLOWED_USER_ID) {
    bot.use(async (ctx, next) => {
      if (String(ctx.from?.id) !== ALLOWED_USER_ID) return;
      return next();
    });
  }

  bot.command('start', async (ctx) => {
    db.setChatId(ctx.chat.id);
    await ctx.reply(msg.welcomeMessage());
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(msg.welcomeMessage());
  });

  bot.command('today', async (ctx) => {
    const log = db.getDailyLog(getTodayHST());
    await ctx.reply(msg.todaySummary(log));
  });

  bot.command('week', async (ctx) => {
    const logs = db.getRecentLogs(7);
    await ctx.reply(msg.weekSummary(logs));
  });

  bot.command('syncfitbit', async (ctx) => {
    await ctx.reply('Syncing Fitbit now (recent days)...');
    try {
      const out = await syncRecentFitbitData(3);
      await ctx.reply(
        `Fitbit sync done: ${out.successCount} day(s) synced, ${out.warningsCount} warning(s), ${out.errorsCount} error(s).`
      );
    } catch (err) {
      await ctx.reply(`Fitbit sync failed: ${err.message}`);
    }
  });

  bot.command('status', async (ctx) => {
    const today = getTodayHST();
    const targetsSent = db.getSetting(`targets_prompt_sent:${today}`) === '1';
    const checkinSent = db.getSetting(`checkin_prompt_sent:${today}`) === '1';
    const pending = getPendingTargets(ctx.chat.id);
    const pendingState = pending
      ? `pending target step: ${pending.type === 'targets_work' ? 'work' : 'personal'}`
      : 'pending target step: none';
    await ctx.reply([
      `Status (${today})`,
      `• 4:30pm target prompt sent: ${targetsSent ? 'yes' : 'no'}`,
      `• 8:00pm check-in prompt sent: ${checkinSent ? 'yes' : 'no'}`,
      `• ${pendingState}`,
    ].join('\n'));
  });

  bot.command('targets', async (ctx) => {
    db.setChatId(ctx.chat.id);
    setPendingTargets(ctx.chat.id);
    await ctx.reply(msg.targetPrompt());
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;

    if (text.startsWith('/')) return;

    // --- Evening reflection (Claude-powered, after form submission) ---
    if (hasActiveConversation(chatId)) {
      try {
        const result = await continueCheckin(chatId, text);
        await ctx.reply(result.message);

      } catch (err) {
        console.error('Check-in error:', err.message);
        clearConversation(chatId);
        await ctx.reply('Something went wrong. Try again in a minute or use /today.');
      }
      return;
    }

    // --- Target-setting flow (simple 2-step, persisted to DB) ---
    const pending = getPendingTargets(chatId);
    if (pending) {
      if (pending.type === 'targets_work') {
        updatePendingTargets(chatId, { type: 'targets_personal', workTarget: text });
        await ctx.reply(msg.targetPersonalPrompt(text));
        return;
      } else if (pending.type === 'targets_personal') {
        const { workTarget } = pending;
        db.upsertDeliverables(getTomorrowHST(), workTarget, text);
        clearPendingTargets(chatId);
        await ctx.reply(msg.targetConfirmation(workTarget, text));
        return;
      }
    }

    // Unrecognized message outside any active conversation
    await ctx.reply('Use /targets to set tomorrow targets. Check-in link arrives at 8:00pm.');
  });

  bot.catch((err) => {
    console.error('Bot error:', err.error ?? err);
  });

  return bot;
}

export function getBot() {
  if (!bot) throw new Error('Bot not created — call createBot() first');
  return bot;
}

export async function sendMessage(chatId, text, options = {}) {
  if (!bot) return false;
  try {
    const payload = { disable_web_page_preview: true };
    if (options.html) payload.parse_mode = 'HTML';
    await bot.api.sendMessage(chatId, text, payload);
    return true;
  } catch (err) {
    console.error('Failed to send message:', err.message);
    return false;
  }
}

export function startCheckinForUser(chatId) {
  clearPendingTargets(chatId);
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const token = createCheckinToken({ chatId, date: getTodayHST(), ttlHours: 24 });
  const link = `${baseUrl.replace(/\/$/, '')}/checkin?token=${encodeURIComponent(token)}`;
  return sendMessage(chatId, msg.eveningCheckinPrompt(link));
}

export function startTargetSettingForUser(chatId) {
  setPendingTargets(chatId);
}

export async function startReflectionForUser(chatId, checkinData) {
  const today = getTodayHST();
  const isToday = checkinData.date === today;

  if (isToday) {
    clearPendingTargets(chatId);
    startCheckin(String(chatId), checkinData);
    await sendMessage(chatId, msg.reflectionStartPrompt(checkinData.daily_score ?? '?'));
  } else {
    await sendMessage(chatId, msg.pastCheckinConfirmation(checkinData.date, checkinData.daily_score ?? '?'));
  }
}
