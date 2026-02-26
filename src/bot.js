import { Bot } from 'grammy';
import * as db from './db.js';
import { getTodayHST, getTomorrowHST } from './scoring.js';
import * as msg from './messages.js';
import { startCheckin, hasActiveConversation, continueCheckin, clearConversation } from './claude.js';
import { createCheckinToken } from './checkin-link.js';

let bot;

// In-memory target-setting state: chatId → { type: 'targets_work'|'targets_personal', workTarget?: string }
const pendingTargets = new Map();

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

  bot.command('targets', async (ctx) => {
    db.setChatId(ctx.chat.id);
    pendingTargets.set(ctx.chat.id, { type: 'targets_work' });
    await ctx.reply(msg.targetPrompt());
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;

    if (text.startsWith('/')) return;

    db.setChatId(chatId);

    // --- Target-setting flow (simple 2-step, no Claude needed) ---
    const pending = pendingTargets.get(chatId);
    if (pending) {
      if (pending.type === 'targets_work') {
        pending.workTarget = text;
        pending.type = 'targets_personal';
        await ctx.reply(msg.targetPersonalPrompt(text));
        return;
      }
      if (pending.type === 'targets_personal') {
        const { workTarget } = pending;
        db.upsertDeliverables(getTomorrowHST(), workTarget, text);
        pendingTargets.delete(chatId);
        await ctx.reply(msg.targetConfirmation(workTarget, text));
        return;
      }
    }

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

    // Unrecognized message outside any active conversation
    await ctx.reply('Use /targets to set tomorrow targets. Check-in link arrives at 8:30pm.');
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

export async function sendMessage(chatId, text) {
  if (!bot) return;
  try {
    await bot.api.sendMessage(chatId, text);
  } catch (err) {
    console.error('Failed to send message:', err.message);
  }
}

export function startCheckinForUser(chatId) {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const token = createCheckinToken({ chatId, date: getTodayHST(), ttlHours: 24 });
  const link = `${baseUrl.replace(/\/$/, '')}/checkin?token=${encodeURIComponent(token)}`;
  return sendMessage(chatId, msg.eveningCheckinPrompt(link));
}

export function startTargetSettingForUser(chatId) {
  pendingTargets.set(chatId, { type: 'targets_work' });
}

export async function startReflectionForUser(chatId, checkinData) {
  startCheckin(String(chatId), checkinData);
  await sendMessage(chatId, msg.reflectionStartPrompt(checkinData.daily_score ?? '?'));
}
