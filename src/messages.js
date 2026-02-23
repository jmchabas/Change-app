export function welcomeMessage() {
  return `LifeOS is running. Here's your daily rhythm:

• 5:00pm  — Set tomorrow's 2 targets + gym reminder
• 8:30pm  — Evening check-in (just talk to me)
• 7:00am  — Morning brief + today's targets
• Sun 5pm — Weekly coaching review

Commands:
/today   — today's log
/week    — 7-day summary
/targets — set tomorrow's targets now
/help    — this message`;
}

export function targetPrompt() {
  return `Time to wrap up and set tomorrow up.\n\nWhat's your work win for tomorrow? (1 deliverable)`;
}

export function targetPersonalPrompt(workTarget) {
  return `Got it: "${workTarget}"\n\nAnd your personal/business win for tomorrow?`;
}

export function targetConfirmation(workTarget, personalTarget) {
  return `Locked in for tomorrow:\n→ Work: ${workTarget}\n→ Personal: ${personalTarget}\n\nNow close the laptop. Time for the gym.`;
}

export function eveningCheckinPrompt() {
  return `Evening check-in. How was your day — just tell me.`;
}

export function morningBrief({ yesterday, targets, trend }) {
  const yn = v => v === 1 ? '✓' : v === 0 ? '✗' : '?';

  let scoreBlock = 'No log for yesterday.';
  if (yesterday) {
    const stressCluster = [yesterday.no_escape_media, yesterday.fixed_eating, yesterday.clean_evening]
      .filter(v => v === 0).length;
    const clusterNote = stressCluster >= 2 ? ' ⚠️ stress cluster' : '';
    scoreBlock = [
      `Yesterday: ${yesterday.total_score ?? '?'}/8  mood ${yesterday.mood ?? '?'}/5${clusterNote}`,
      `Focus ${yn(yesterday.no_escape_media)} · Eating ${yn(yesterday.fixed_eating)} · Clean ${yn(yesterday.clean_evening)}`,
      `Work ${yn(yesterday.work_win)} · Personal ${yn(yesterday.personal_win)} · Gym ${yn(yesterday.gym)}`,
      `Kids ${yn(yesterday.kids_quality)} · Bed ${yn(yesterday.bed_on_time)}`,
    ].join('\n');
  }

  const trendLine = trend ? `Trend: ${trend}\n` : '';

  let targetsBlock = 'No targets set for today. Use /targets to add them.';
  if (targets) {
    targetsBlock = `Today's mission:\n→ Work: ${targets.work_target}\n→ Personal: ${targets.personal_target}`;
  }

  return `Morning.\n\n${scoreBlock}\n${trendLine}\n${targetsBlock}`;
}

export function weeklyReviewIntro() {
  return `Sunday review.`;
}

export function todaySummary(log) {
  if (!log) return 'No check-in logged today yet.';
  const yn = v => v === 1 ? '✓' : v === 0 ? '✗' : '?';
  return [
    `Today (${log.date}): ${log.total_score ?? '?'}/8  mood ${log.mood ?? '?'}/5`,
    `Focus ${yn(log.no_escape_media)} · Eating ${yn(log.fixed_eating)} · Clean ${yn(log.clean_evening)}`,
    `Work ${yn(log.work_win)} · Personal ${yn(log.personal_win)} · Gym ${yn(log.gym)}`,
    `Kids ${yn(log.kids_quality)} · Bed ${yn(log.bed_on_time)}`,
    log.stress_note ? `\nNote: ${log.stress_note}` : '',
  ].join('\n');
}

export function weekSummary(logs) {
  if (logs.length === 0) return 'No data for the last 7 days.';
  const avg = (logs.reduce((s, r) => s + (r.total_score || 0), 0) / logs.length).toFixed(1);
  const avgMood = logs.filter(l => l.mood).length > 0
    ? (logs.reduce((s, l) => s + (l.mood || 0), 0) / logs.filter(l => l.mood).length).toFixed(1)
    : '?';
  const lines = logs.map(r => `${r.date}: ${r.total_score ?? '?'}/8  mood ${r.mood ?? '?'}/5`);
  return `Last ${logs.length} days:\n${lines.join('\n')}\n\nAvg: ${avg}/8  Avg mood: ${avgMood}/5`;
}
