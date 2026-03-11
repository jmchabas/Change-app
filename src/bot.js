import { Bot, InlineKeyboard } from 'grammy';
import * as db from './db.js';
import { getTodayLocal, getTomorrowLocal, getYesterdayLocal } from './scoring.js';
import * as msg from './messages.js';
import { startCheckin, hasActiveConversation, continueCheckin, clearConversation } from './claude.js';
import { createCheckinToken } from './checkin-link.js';
import { syncRecentFitbitData } from './fitbit.js';

let bot;

const TARGET_FLOW_TTL_MS = 4 * 60 * 60 * 1000;
const PENDING_KEY = 'pending_targets';
const PULSE_KEY = 'morning_pulse';

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

// --- Morning Pulse state (DB-persisted) ---

function getPulseState(chatId) {
  const raw = db.getSetting(`${PULSE_KEY}:${Number(chatId)}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function setPulseState(chatId, state) {
  db.setSetting(`${PULSE_KEY}:${Number(chatId)}`, JSON.stringify(state));
}

function clearPulseState(chatId) {
  db.deleteSetting(`${PULSE_KEY}:${Number(chatId)}`);
}

function pulseKeyboard(dimension) {
  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) {
    kb.text(`${i}`, `pulse_${dimension}_${i}`);
  }
  return kb;
}

const PULSE_LABELS = { energy: '⚡ Energy', clarity: '🧠 Mental clarity', intention: '🎯 Intention' };
const PULSE_STEPS = ['energy', 'clarity', 'intention'];

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
    const log = db.getDailyLog(getTodayLocal());
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
    const today = getTodayLocal();
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
        if (result.done) {
          await ctx.reply("Locked in. I'll remind you tomorrow morning.");
        }
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
        db.upsertDeliverables(getTomorrowLocal(), workTarget, text);
        clearPendingTargets(chatId);
        await ctx.reply(msg.targetConfirmation(workTarget, text));
        return;
      }
    }

    // Unrecognized message outside any active conversation
    await ctx.reply('Use /targets to set tomorrow targets. Check-in link arrives at 8:00pm.');
  });

  // --- Morning pulse inline button callbacks ---
  bot.callbackQuery(/^pulse_/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    if (!chatId) return ctx.answerCallbackQuery();

    const match = data.match(/^pulse_(energy|clarity|intention)_([1-5])$/);
    if (!match) return ctx.answerCallbackQuery();

    const dimension = match[1];
    const value = Number(match[2]);
    const state = getPulseState(chatId) || { date: getTodayLocal() };
    state[dimension] = value;

    const currentStep = PULSE_STEPS.indexOf(dimension);
    const nextStep = currentStep + 1;

    if (nextStep < PULSE_STEPS.length) {
      setPulseState(chatId, state);
      const filled = PULSE_STEPS.slice(0, nextStep)
        .map(s => `${PULSE_LABELS[s]}: ${state[s]}/5 ✓`).join('\n');
      const nextDim = PULSE_STEPS[nextStep];
      await ctx.editMessageText(
        `${filled}\n\n${PULSE_LABELS[nextDim]}:`,
        { reply_markup: pulseKeyboard(nextDim) }
      );
    } else {
      db.upsertMorningPulse(state.date, {
        energy: state.energy,
        clarity: state.clarity,
        intention: state.intention,
      });
      clearPulseState(chatId);
      const summary = PULSE_STEPS
        .map(s => `${PULSE_LABELS[s]}: ${state[s]}/5`).join(' · ');
      await ctx.editMessageText(`✅ Morning pulse saved\n${summary}`);
    }
    await ctx.answerCallbackQuery();
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
    if (options.reply_markup) payload.reply_markup = options.reply_markup;
    await bot.api.sendMessage(chatId, text, payload);
    return true;
  } catch (err) {
    console.error('Failed to send message:', err.message);
    return false;
  }
}

export async function sendPulsePrompt(chatId) {
  if (!bot) return false;
  const today = getTodayLocal();
  const existing = db.getMorningPulse(today);
  if (existing) return false;
  setPulseState(chatId, { date: today });
  return sendMessage(chatId, `${PULSE_LABELS.energy}:`, {
    reply_markup: pulseKeyboard('energy'),
  });
}

export function startCheckinForUser(chatId) {
  clearPendingTargets(chatId);
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const token = createCheckinToken({ chatId, date: getTodayLocal(), ttlHours: 24 });
  const link = `${baseUrl.replace(/\/$/, '')}/checkin?token=${encodeURIComponent(token)}`;
  return sendMessage(chatId, msg.eveningCheckinPrompt(link));
}

export function startTargetSettingForUser(chatId) {
  setPendingTargets(chatId);
}

export async function startReflectionForUser(chatId, checkinData) {
  const today = getTodayLocal();
  const isToday = checkinData.date === today;

  if (isToday) {
    clearPendingTargets(chatId);
    startCheckin(String(chatId), checkinData);
    await sendMessage(chatId, msg.reflectionStartPrompt(checkinData.daily_score ?? '?', checkinData.mood_1_10));
  } else {
    await sendMessage(chatId, msg.pastCheckinConfirmation(checkinData.date, checkinData.daily_score ?? '?', checkinData.mood_1_10));
  }
}
