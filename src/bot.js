import { Bot } from 'grammy';
import * as db from './db.js';
import { getTodayHST, getTomorrowHST } from './scoring.js';
import * as msg from './messages.js';
import { startCheckin, hasActiveConversation, continueCheckin, clearConversation } from './claude.js';
import { createCheckinToken } from './checkin-link.js';
import { syncRecentFitbitData } from './fitbit.js';

let bot;

// In-memory target-setting state: chatId → { type: 'targets_work'|'targets_personal', workTarget?: string }
const pendingTargets = new Map();
const TARGET_FLOW_TTL_MS = 90 * 60 * 1000;

function setPendingTargets(chatId) {
  pendingTargets.set(chatId, {
    type: 'targets_work',
    workTarget: '',
    expiresAt: Date.now() + TARGET_FLOW_TTL_MS,
  });
}

export function createBot(token) {
  bot = new Bot(token);

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
    const pending = pendingTargets.get(ctx.chat.id);
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

    db.setChatId(chatId);

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

    // --- Target-setting flow (simple 2-step, no Claude needed) ---
    const pending = pendingTargets.get(chatId);
    if (pending) {
      if (!pending.expiresAt || Date.now() > pending.expiresAt) {
        pendingTargets.delete(chatId);
      } else if (pending.type === 'targets_work') {
        pending.workTarget = text;
        pending.type = 'targets_personal';
        pending.expiresAt = Date.now() + TARGET_FLOW_TTL_MS;
        await ctx.reply(msg.targetPersonalPrompt(text));
        return;
      } else if (pending.type === 'targets_personal') {
        const { workTarget } = pending;
        db.upsertDeliverables(getTomorrowHST(), workTarget, text);
        pendingTargets.delete(chatId);
        await ctx.reply(msg.targetConfirmation(workTarget, text));
        return;
      }
    }

    // Unrecognized message outside any active conversation
    await ctx.reply('Use /targets to set tomorrow targets. Check-in link arrives at 8:00pm.');
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  return bot;
}

export function getBot() {
  if (!bot) throw new Error('Bot not created — call createBot() first');
  return bot;
}

export async function sendMessage(chatId, text, options = {}) {
  if (!bot) return;
  try {
    const payload = { disable_web_page_preview: true };
    if (options.html) payload.parse_mode = 'HTML';
    await bot.api.sendMessage(chatId, text, payload);
  } catch (err) {
    console.error('Failed to send message:', err.message);
  }
}

export function startCheckinForUser(chatId) {
  // Avoid target-setting prompts colliding with evening reflection messages.
  pendingTargets.delete(chatId);
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const token = createCheckinToken({ chatId, date: getTodayHST(), ttlHours: 24 });
  const link = `${baseUrl.replace(/\/$/, '')}/checkin?token=${encodeURIComponent(token)}`;
  return sendMessage(chatId, msg.eveningCheckinPrompt(link));
}

export function startTargetSettingForUser(chatId) {
  setPendingTargets(chatId);
}

export async function startReflectionForUser(chatId, checkinData) {
  startCheckin(String(chatId), checkinData);
  await sendMessage(chatId, msg.reflectionStartPrompt(checkinData.daily_score ?? '?'));
}
