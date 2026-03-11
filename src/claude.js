import Anthropic from '@anthropic-ai/sdk';
import * as db from './db.js';

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var
const MODEL = 'claude-sonnet-4-6';

const REFLECTION_SYSTEM = `You are Jean-Mathieu's direct life coach.

You already have his structured daily check-in values.
Your task is evening reflection and accountability, not data collection.

Style:
- short, direct, warm
- name patterns clearly
- no therapy language, no lectures
- ask one sharp follow-up question at a time
- focus on execution + stress loop + next concrete move

Rules:
- Assume form data is true unless user says otherwise.
- Keep responses 2-6 sentences.
- If there are misses, prioritize: escape media, outside-window meals, clean eve.
- End most replies with one concrete next action for tomorrow.
- When the user identifies a trigger or risk situation, suggest a specific if-then plan: "If [trigger], then [action]". Keep it concrete and actionable.
`;

// In-memory conversation state: chatId → { messages: [], context: string, turn: 0, createdAt: number }
const conversations = new Map();
const CONV_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function isConversationExpired(conv) {
  return conv && conv.createdAt && Date.now() - conv.createdAt > CONV_TTL_MS;
}

async function callClaude(params, retries = 2) {
  try {
    return await client.messages.create(params);
  } catch (err) {
    const retryable = [429, 500, 502, 503, 529].includes(err.status);
    if (retryable && retries > 0) {
      const delay = (3 - retries) * 2000;
      await new Promise(r => setTimeout(r, delay));
      return callClaude(params, retries - 1);
    }
    throw err;
  }
}

function formatContext(context) {
  if (!context) return 'No structured check-in context was provided.';
  const lines = [
    `Daily score: ${context.daily_score ?? '?'} / 100 (behavior ${context.behavior_score ?? '?'}/80, state ${context.state_score ?? '?'}/20)`,
    `Escape media: ${context.escape_media_minutes ?? '?'} min`,
    `Meals outside windows: ${context.outside_window_meals ?? '?'}`,
    `Clean Eve: ${context.clean_evening ? 'Yes' : 'No'}${context.clean_evening_substances ? ` (${context.clean_evening_substances})` : ''}`,
    `Work win: ${context.work_win ? 'Yes' : 'No'}`,
    `Personal win: ${context.personal_win ? 'Yes' : 'No'}`,
    `Gym: ${context.gym ? `Yes (${context.gym_type || 'unspecified'})` : 'No'}`,
    `Kids quality: ${context.kids_quality ? 'Yes' : 'No'}${context.kids_quality_note ? ` — ${context.kids_quality_note}` : ''}`,
    `Bed time: ${context.bed_time_text || '?'}`,
    `Mood: ${context.mood_1_10 ?? '?'} / 10`,
  ];

  const stackCheck = (v) => v === 1 ? '✓' : v === 0 ? '✗' : '?';
  if (context.coffee != null || context.adhd_meds != null) {
    lines.push(`Daily stack: coffee ${stackCheck(context.coffee)}, ADHD meds ${stackCheck(context.adhd_meds)}, gut bacteria ${stackCheck(context.gut_bacteria_mgr)}, gut movement ${stackCheck(context.gut_mvmt)}`);
  }

  if (context.recentDays?.length) {
    lines.push('', 'RECENT DAYS:');
    for (const d of context.recentDays) {
      lines.push(`  ${d.date}: ${d.daily_score ?? '?'}/100, mood ${d.mood_1_10 ?? '?'}/10`);
    }
  }

  if (context.streaks && Object.keys(context.streaks).length) {
    const parts = Object.values(context.streaks).map(s => `${s.label}: ${s.count}d`);
    lines.push('', `STREAKS: ${parts.join(' · ')}`);
  }

  if (context.commitment) {
    lines.push('', `LAST COMMITMENT: "${context.commitment}"`);
  }

  if (context.morningPulse) {
    const p = context.morningPulse;
    lines.push('', `MORNING PULSE: energy ${p.energy}/5, clarity ${p.clarity}/5, intention ${p.intention}/5`);
  }

  return lines.join('\n');
}

export function startCheckin(chatId, context = null) {
  conversations.set(String(chatId), {
    messages: [],
    context: formatContext(context),
    date: context?.date || null,
    turn: 0,
    createdAt: Date.now(),
  });
}

export function hasActiveConversation(chatId) {
  const conv = conversations.get(String(chatId));
  if (conv && isConversationExpired(conv)) {
    conversations.delete(String(chatId));
    return false;
  }
  return conversations.has(String(chatId));
}

export function clearConversation(chatId) {
  conversations.delete(String(chatId));
}

export async function continueCheckin(chatId, userMessage) {
  const conv = conversations.get(String(chatId));
  if (!conv) throw new Error('No active check-in conversation');
  if (isConversationExpired(conv)) {
    conversations.delete(String(chatId));
    throw new Error('No active check-in conversation');
  }

  conv.messages.push({ role: 'user', content: userMessage });
  conv.turn++;

  const baseSystem = conv.system || REFLECTION_SYSTEM;

  let turnDirective = '';
  if (!conv.system && conv.turn >= 6) {
    turnDirective = '\nThis is near the end of the reflection. Ask for one specific commitment for tomorrow and confirm it clearly.';
  }
  if (!conv.system && conv.turn >= 3) {
    turnDirective += '\nIf the user states a specific commitment or action, include it in your response prefixed with COMMITMENT: on its own line.';
  }

  const systemWithTurn = `${baseSystem}${turnDirective}

${conv.context ? `Context:\n${conv.context}\n` : ''}
Current conversation turn: ${conv.turn}`;

  const response = await callClaude({
    model: MODEL,
    max_tokens: 500,
    system: systemWithTurn,
    messages: conv.messages,
  });

  const assistantText = response?.content?.[0]?.text || 'I had trouble generating a response. Try again.';
  conv.messages.push({ role: 'assistant', content: assistantText });

  const commitmentMatch = assistantText.match(/^COMMITMENT:\s*(.+)$/m);
  if (commitmentMatch && conv.date) {
    try { db.saveCommitment(conv.date, commitmentMatch[1].trim()); } catch { /* best effort */ }
  }

  const closing = conv.turn >= 8;
  if (closing) clearConversation(chatId);
  return { done: closing, message: assistantText, data: null };
}

const WEEKLY_COACHING_SYSTEM = `You are Jean-Mathieu's direct life coach, continuing a conversation after his weekly review.

He just read your weekly coaching summary and is replying with thoughts, questions, or reactions.

Style:
- short, direct, warm
- reference specific days/data from the week when relevant
- no therapy language, no lectures
- ask one sharp follow-up question at a time
- focus on execution + what to change next week

Rules:
- Keep responses 2-6 sentences.
- Be concrete — reference his actual data, not generic advice.
- If he pushes back or shares context, adapt. Don't repeat the review.
- End most replies with one actionable suggestion or probing question.
`;

export function startWeeklyCoaching(chatId, weeklyReviewText, weekContext) {
  conversations.set(String(chatId), {
    messages: [
      { role: 'assistant', content: weeklyReviewText },
    ],
    context: weekContext,
    turn: 0,
    system: WEEKLY_COACHING_SYSTEM,
    createdAt: Date.now(),
  });
}

export async function generateWeeklyReview({ logs, breakLogs, avgMood, wearableContext, stackStats, dayOfWeekPatterns }) {
  const yn = v => v === 1 ? '✓' : v === 0 ? '✗' : '?';

  const logsText = logs.map(l => {
    const habits = [
      `focus:${yn(l.no_escape_media)}`,
      `eating:${yn(l.fixed_eating)}`,
      `cleanEve:${yn(l.clean_evening)}`,
      `work:${yn(l.work_win)}`,
      `perso:${yn(l.personal_win)}`,
      `gym:${yn(l.gym)}`,
      `kids:${yn(l.kids_quality)}`,
      `bed:${yn(l.bed_on_time)}`,
    ].join(' ');
    return `${l.date} — ${l.daily_score ?? '?'} /100 mood:${l.mood_1_10 ?? '?'}/10 — ${habits}${l.stress_note ? ` | "${l.stress_note}"` : ''}`;
  }).join('\n');

  const breakText = breakLogs.length > 0
    ? breakLogs.map(b => `${b.date} ${b.habit}: ${b.reason}`).join('\n')
    : 'No specific break reasons logged.';

  let extraSections = '';

  if (wearableContext) {
    extraSections += `\nWEARABLES:
Avg sleep: ${wearableContext.avgSleep ?? '?'}h (prev week: ${wearableContext.prevAvgSleep ?? '?'}h)
Avg RHR: ${wearableContext.avgRhr ?? '?'} bpm (prev week: ${wearableContext.prevAvgRhr ?? '?'} bpm)
Avg sleep score: ${wearableContext.avgSleepScore ?? '?'} (prev week: ${wearableContext.prevAvgSleepScore ?? '?'})\n`;
  }

  if (stackStats) {
    const items = Object.entries(stackStats).map(([k, v]) => `${k}: ${v}%`).join(', ');
    extraSections += `\nDAILY STACK CONSISTENCY: ${items}\n`;
  }

  if (dayOfWeekPatterns) {
    extraSections += `\nDAY-OF-WEEK PATTERNS (avg score):\n${dayOfWeekPatterns}\n`;
  }

  const prompt = `Here is Jean-Mathieu's week:

DAILY LOGS:
${logsText}

BREAK REASONS:
${breakText}

Average mood: ${avgMood ?? 'unknown'}/10
${extraSections}
Write a weekly coaching review — direct, personal, under 180 words. Structure:
1. The key pattern you actually see in the data (be specific — reference days and habits)
2. The stress theme driving the misses, if visible
3. One concrete action for next week (specific and actionable, not generic)

No bullet points. Coach-speak. Reference his stress loop (work stress → escapes → bad evening) if relevant. He knows what to do — help him see what's actually happening.`;

  const response = await callClaude({
    model: MODEL,
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  });

  return response?.content?.[0]?.text || 'I had trouble generating a response. Try again.';
}
