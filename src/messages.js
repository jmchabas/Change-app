export function welcomeMessage() {
  return `Welcome to LifeOS.

Every evening I'll ask you to log your day (30 seconds).
Every morning I'll send your score + focus.
Every Sunday I'll send a weekly review.

Commands:
/today — see today's log
/week — see 7-day summary
/help — format reminder

To log manually, send:
<sleep_hours> <bed Y/N> <workout Y/N> <eat Y/N> <block1 Y/N> <block2 Y/N> <anchor Y/N>

Example: 7.5 Y Y Y Y N Y`;
}

export function helpMessage() {
  return `Log format (7 values, space-separated):

<SLEEP_HOURS> <BED_ON_TIME> <WORKOUT> <EAT_WINDOWS> <BLOCK1> <BLOCK2> <ANCHOR>

Each Y/N field:
• Bed on time — in bed within your 60-min window?
• Workout — did you train today?
• Eating windows — only ate during scheduled windows?
• Block 1 — 90-min deep work, no Slack/email?
• Block 2 — 60-min deep work, no Slack/email?
• Anchor — meaningful social or family moment?

Example: 7.5 Y Y Y Y N Y
(7.5h sleep, bed on time, worked out, ate clean, nailed block 1, skipped block 2, had anchor)`;
}

export function logConfirmation(data) {
  const yn = v => v ? '✓' : '✗';
  return `Logged ${data.date}.

Sleep: ${data.sleep_hours}h ${data.sleep_hours >= 7.5 ? '✓' : '✗'}
Bed on time: ${yn(data.bed_on_time)}  Workout: ${yn(data.workout)}  Eat: ${yn(data.eat_windows)}
Block 1: ${yn(data.block1)}  Block 2: ${yn(data.block2)}  Anchor: ${yn(data.anchor)}

Score: ${data.total_score}/7 (Energy ${data.energy_score}/4, Exec ${data.exec_score}/2, Life ${data.life_score}/1)`;
}

export function eveningPrompt() {
  return `Log your day (30 sec). Reply with:

<SLEEP> <BED Y/N> <WORKOUT Y/N> <EAT Y/N> <BLOCK1 Y/N> <BLOCK2 Y/N> <ANCHOR Y/N>

Example: 7.2 Y N Y Y Y N`;
}

export function morningBrief({ yesterday, avg7, trend, driftStr, suggestion }) {
  if (!yesterday) {
    return `☀️ Morning.
No log for yesterday. Don't skip tonight.

Today's focus:
1) Win Execution Block 1.
2) Respect eating windows.
3) One life move: ${suggestion}`;
  }

  return `☀️ Morning.
Yesterday: ${yesterday.total_score}/7 (Energy ${yesterday.energy_score}/4, Exec ${yesterday.exec_score}/2, Life ${yesterday.life_score}/1)
7-day avg: ${avg7}/7 | Trend: ${trend}
Drift: ${driftStr}

Today's focus:
1) Win Execution Block 1.
2) Respect eating windows.
3) One life move: ${suggestion}`;
}

export function weeklyReview(stats) {
  return `📊 Weekly review.
Avg: ${stats.avg_score}/7
Best day: ${stats.best_day} (${stats.best_score}/7)
Weakest: ${stats.worst_day} (${stats.worst_score}/7)
Biggest drift: ${stats.biggest_drift}

One fix this week: ${stats.one_fix}

Schedule now: 3 workouts + 1 high-signal social + 1 family fun anchor.`;
}

export function todaySummary(log) {
  if (!log) return 'No log for today yet. Send your 7 values to log.';
  return logConfirmation(log);
}

export function weekSummary(logs, trend, drift) {
  if (logs.length === 0) return 'No data for the last 7 days.';

  const avg = (logs.reduce((s, r) => s + r.total_score, 0) / logs.length).toFixed(1);
  const lines = logs.map(r => `${r.date}: ${r.total_score}/7`);

  return `Last ${logs.length} days:
${lines.join('\n')}

Avg: ${avg}/7 | Trend: ${trend}
Drift: ${drift.biggest}`;
}
