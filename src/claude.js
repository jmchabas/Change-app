import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var
const MODEL = 'claude-sonnet-4-6';

const CHECKIN_SYSTEM = `You are the personal life coach for Jean-Mathieu. You conduct his nightly check-in to score his day across 8 habits.

## The 8 Habits (1=done, 0=not done, null=unknown)
1. no_escape_media — No TikTok, news, or distracting videos during work hours
2. fixed_eating — Ate only at fixed meal times (no stress snacking between meals)
3. clean_evening — No alcohol or weed in the evening
4. work_win — Completed his 1 major work deliverable for the day
5. personal_win — Completed his 1 personal/business (side hustle) deliverable
6. gym — Worked out (gym or meaningful exercise)
7. kids_quality — Quality, present time with kids (reading, real conversation — not distracted)
8. bed_on_time — In bed by 10pm

## Mood score (1–5)
1=terrible, 2=rough, 3=okay, 4=good, 5=great

## Conversation rules
- Turn 1: Extract what you can. If 3+ habits are unclear, ask ONE brief follow-up covering the most important gaps (prioritize the stress escapes: no_escape_media, fixed_eating, clean_evening).
- Turn 2: Extract remaining. Ask at most ONE more question only if a stress escape habit is truly unknown.
- Turn 3 (FINAL): You MUST finalize regardless of missing data. Use null for genuinely unknown habits.

## When finalizing, end your message with EXACTLY this block on its own line (valid JSON, no trailing text after):
HABIT_DATA:{"no_escape_media":1,"fixed_eating":1,"clean_evening":1,"work_win":1,"personal_win":0,"gym":1,"kids_quality":1,"bed_on_time":null,"mood":4,"stress_note":"","break_reasons":[]}

The break_reasons array should contain objects like {"habit":"fixed_eating","reason":"stress ate after difficult call"} for each habit scored 0.

## Jean-Mathieu's context
His stress loop: work stress → TikTok/news escape → exhaustion → alcohol/weed → not present with kids → poor sleep
His why: build a legacy, be a great father, reach financial independence, eventually serve in politics
His principles: trust the process, 100% present, focus on one thing, long-term only

## Your style
- Direct and warm — like a trusted friend who holds him accountable, not a therapist
- When stress escapes break, name it and ask what drove it — he needs to see the pattern
- Keep coaching to 2–3 sentences after the score. No lectures. No moralizing.`;

// In-memory conversation state: chatId → { messages: [], turn: 0 }
const conversations = new Map();

export function startCheckin(chatId) {
  conversations.set(String(chatId), { messages: [], turn: 0 });
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

  const systemWithTurn = CHECKIN_SYSTEM + `\n\n## Current turn: ${conv.turn} of 3 max`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: systemWithTurn,
    messages: conv.messages,
  });

  const assistantText = response.content[0].text;
  conv.messages.push({ role: 'assistant', content: assistantText });

  // Detect finalization — HABIT_DATA block present
  const match = assistantText.match(/HABIT_DATA:(\{[\s\S]*\})\s*$/m);
  if (match) {
    let data = null;
    try {
      data = JSON.parse(match[1]);
    } catch {
      // malformed JSON — still end conversation, data will be null
    }
    clearConversation(chatId);
    const coachingText = assistantText.replace(/HABIT_DATA:[\s\S]*$/m, '').trim();
    return { done: true, message: coachingText, data };
  }

  // Force end after max turns
  if (conv.turn >= 3) {
    clearConversation(chatId);
    return { done: true, message: assistantText, data: null };
  }

  return { done: false, message: assistantText };
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
    return `${l.date} — ${l.total_score ?? '?'}/8 mood:${l.mood ?? '?'}/5 — ${habits}${l.stress_note ? ` | "${l.stress_note}"` : ''}`;
  }).join('\n');

  const breakText = breakLogs.length > 0
    ? breakLogs.map(b => `${b.date} ${b.habit}: ${b.reason}`).join('\n')
    : 'No specific break reasons logged.';

  const prompt = `Here is Jean-Mathieu's week:

DAILY LOGS:
${logsText}

BREAK REASONS:
${breakText}

Average mood: ${avgMood ?? 'unknown'}/5

Write a weekly coaching review — direct, personal, under 160 words. Structure:
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
