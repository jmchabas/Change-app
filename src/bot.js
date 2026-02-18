import { Bot } from 'grammy';
import * as db from './db.js';
import { parseLogMessage, getTodayHST, getYesterdayHST, detectDrift, computeTrend } from './scoring.js';
import * as msg from './messages.js';

let bot;

export function createBot(token) {
  bot = new Bot(token);

  bot.command('start', async (ctx) => {
    db.setChatId(ctx.chat.id);
    await ctx.reply(msg.welcomeMessage());
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(msg.helpMessage());
  });

  bot.command('today', async (ctx) => {
    const log = db.getDailyLog(getTodayHST());
    await ctx.reply(msg.todaySummary(log));
  });

  bot.command('week', async (ctx) => {
    const logs = db.getRecentLogs(7);
    const trend = computeTrend(logs);
    const drift = detectDrift(logs);
    await ctx.reply(msg.weekSummary(logs, trend, drift));
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    if (text.startsWith('/')) return;

    db.setChatId(ctx.chat.id);

    const result = parseLogMessage(text);
    if (!result.ok) {
      await ctx.reply(`⚠️ ${result.error}`);
      return;
    }

    db.upsertDailyLog(result.data);
    await ctx.reply(msg.logConfirmation(result.data));
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
