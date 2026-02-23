import { Bot } from 'grammy';
import * as db from './db.js';
import { getTodayHST, getTomorrowHST, computeScore } from './scoring.js';
import * as msg from './messages.js';
import { startCheckin, hasActiveConversation, continueCheckin, clearConversation } from './claude.js';

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

    // --- Evening check-in (Claude-powered) ---
    if (hasActiveConversation(chatId)) {
      try {
        const result = await continueCheckin(chatId, text);

        if (result.done && result.data) {
          const today = getTodayHST();
          const habits = result.data;
          const total_score = computeScore(habits);

          db.upsertDailyLog({
            date: today,
            no_escape_media: habits.no_escape_media ?? null,
            fixed_eating: habits.fixed_eating ?? null,
            clean_evening: habits.clean_evening ?? null,
            work_win: habits.work_win ?? null,
            personal_win: habits.personal_win ?? null,
            gym: habits.gym ?? null,
            kids_quality: habits.kids_quality ?? null,
            bed_on_time: habits.bed_on_time ?? null,
            total_score,
            mood: habits.mood ?? null,
            stress_note: habits.stress_note || '',
          });

          if (Array.isArray(habits.break_reasons) && habits.break_reasons.length > 0) {
            db.insertBreakLogs(today, habits.break_reasons);
          }

          // Flag stress cluster (2+ stress escapes broken)
          const stressBreaks = ['no_escape_media', 'fixed_eating', 'clean_evening']
            .filter(h => habits[h] === 0).length;
          const clusterWarning = stressBreaks >= 2
            ? '\n\nStress cluster today — two or more escapes. Worth paying attention to.' : '';

          const scoreText = `\n\nScore: ${total_score}/8  ·  Mood: ${habits.mood ?? '?'}/5${clusterWarning}`;
          await ctx.reply((result.message || '') + scoreText);

        } else if (result.done) {
          // Claude finalized but data parsing failed — still acknowledge
          await ctx.reply(result.message || 'Check-in saved. Use /today to see your log.');

        } else {
          // Conversation still in progress — relay Claude's follow-up question
          await ctx.reply(result.message);
        }

      } catch (err) {
        console.error('Check-in error:', err.message);
        clearConversation(chatId);
        await ctx.reply('Something went wrong. Try again or use /today to see today\'s log.');
      }
      return;
    }

    // Unrecognized message outside any active conversation
    await ctx.reply('Check-in opens at 8:30pm. Use /targets to set tomorrow\'s targets, or /help for all commands.');
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
  startCheckin(String(chatId));
}

export function startTargetSettingForUser(chatId) {
  pendingTargets.set(chatId, { type: 'targets_work' });
}
