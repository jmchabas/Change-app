import Anthropic from '@anthropic-ai/sdk';

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
- If there are misses, prioritize: escape media, outside-window meals, clean evening.
- End most replies with one concrete next action for tomorrow.
`;

// In-memory conversation state: chatId → { messages: [], context: string, turn: 0 }
const conversations = new Map();

function formatContext(context) {
  if (!context) return 'No structured check-in context was provided.';
  return [
    `Daily score: ${context.daily_score ?? '?'} / 100 (behavior ${context.behavior_score ?? '?'}/80, state ${context.state_score ?? '?'}/20)`,
    `Escape media: ${context.escape_media_minutes ?? '?'} min`,
    `Meals outside windows: ${context.outside_window_meals ?? '?'}`,
    `Clean evening: ${context.clean_evening ? 'Yes' : 'No'}${context.clean_evening_substances ? ` (${context.clean_evening_substances})` : ''}`,
    `Work win: ${context.work_win ? 'Yes' : 'No'}`,
    `Personal win: ${context.personal_win ? 'Yes' : 'No'}`,
    `Gym: ${context.gym ? `Yes (${context.gym_type || 'unspecified'})` : 'No'}`,
    `Kids quality: ${context.kids_quality ? 'Yes' : 'No'}${context.kids_quality_note ? ` — ${context.kids_quality_note}` : ''}`,
    `Bed time: ${context.bed_time_text || '?'}`,
    `Mood: ${context.mood_1_10 ?? '?'} / 10`,
  ].join('\n');
}

export function startCheckin(chatId, context = null) {
  conversations.set(String(chatId), {
    messages: [],
    context: formatContext(context),
    turn: 0,
  });
}

export function hasActiveConversation(chatId) {
  return conversations.has(String(chatId));
}

export function clearConversation(chatId) {
  conversations.delete(String(chatId));
}

export async function continueCheckin(chatId, userMessage) {
  const conv = conversations.get(String(chatId));
  if (!conv) throw new Error('No active check-in conversation');

  conv.messages.push({ role: 'user', content: userMessage });
  conv.turn++;

  const systemWithTurn = `${REFLECTION_SYSTEM}

Structured check-in context:
${conv.context}

Current reflection turn: ${conv.turn}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: systemWithTurn,
    messages: conv.messages,
  });

  const assistantText = response.content[0].text;
  conv.messages.push({ role: 'assistant', content: assistantText });
  if (conv.turn >= 8) clearConversation(chatId);
  return { done: false, message: assistantText, data: null };
}

export async function generateWeeklyReview({ logs, breakLogs, avgMood }) {
  const yn = v => v === 1 ? '✓' : v === 0 ? '✗' : '?';

  const logsText = logs.map(l => {
    const habits = [
      `focus:${yn(l.no_escape_media)}`,
      `eating:${yn(l.fixed_eating)}`,
      `clean:${yn(l.clean_evening)}`,
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

  const prompt = `Here is Jean-Mathieu's week:

DAILY LOGS:
${logsText}

BREAK REASONS:
${breakText}

Average mood: ${avgMood ?? 'unknown'}/10

Write a weekly coaching review — direct, personal, under 180 words. Structure:
1. The key pattern you actually see in the data (be specific — reference days and habits)
2. The stress theme driving the misses, if visible
3. One concrete action for next week (specific and actionable, not generic)

No bullet points. Coach-speak. Reference his stress loop (work stress → escapes → bad evening) if relevant. He knows what to do — help him see what's actually happening.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}
