function formatSleepHours(hours) {
  const v = Number(hours);
  if (!Number.isFinite(v) || v <= 0) return '?';
  const totalMinutes = Math.round(v * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function welcomeMessage() {
  return `LifeOS is running. Here's your daily rhythm:

• 4:30pm  — Set tomorrow's 2 targets + gym reminder
• 8:00pm  — Evening check-in form link + reflection
• 7:10am  — Fitbit sync before brief
• 7:20am  — Morning brief + today's targets
• Sun 5pm — Weekly coaching review

Commands:
/today   — today's log
/week    — 7-day summary
/targets — set tomorrow's targets now
/syncfitbit — force Fitbit resync
/help    — this message`;
}

export function targetPrompt() {
  return `Time to wrap up and prepare for tomorrow!\n\nWhat's your work win for tomorrow? (1 deliverable)`;
}

export function targetPersonalPrompt(workTarget) {
  return `Got it: "${workTarget}"\n\nAnd your personal/business win for tomorrow?`;
}

export function targetConfirmation(workTarget, personalTarget) {
  return `Locked in for tomorrow:\n→ Work: ${workTarget}\n→ Personal: ${personalTarget}\n\nTargets saved.`;
}

export function eveningCheckinPrompt(link) {
  return `Evening check-in time.\n\nOpen this link and submit today's form:\n${link}\n\nAfter you submit, we'll do a short reflection here.`;
}

export function reflectionStartPrompt(score) {
  return `Got your form.\n\nToday score: ${score}/100.\n\nQuick reflection: what was the main driver of your day?`;
}

function arrowFromDelta(current, previous, lowerIsBetter = false) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return '';
  if (c > p) return lowerIsBetter ? ' ↓' : ' ↑';
  if (c < p) return lowerIsBetter ? ' ↑' : ' ↓';
  return '';
}

export function morningBrief({ yesterday, previousDay, targets, trend, wearable, rhrCurrent, rhrPrevious }) {
  const yn = v => v === 1 ? '✓' : v === 0 ? '✗' : '–';

  let scoreBlock = 'No log for yesterday.';
  if (yesterday) {
    const stressCluster = [yesterday.no_escape_media, yesterday.fixed_eating, yesterday.clean_evening]
      .filter(v => v === 0).length;
    const clusterNote = stressCluster >= 2 ? ' ⚠️ stress cluster' : '';
    const scoreArrow = arrowFromDelta(yesterday.daily_score, previousDay?.daily_score);
    const moodArrow = arrowFromDelta(yesterday.mood_1_10, previousDay?.mood_1_10);
    const rhrArrow = arrowFromDelta(rhrCurrent, rhrPrevious, true);
    const bedTime = yesterday.bed_time_text || '?';
    scoreBlock = [
      `Yesterday: ${yesterday.daily_score ?? '?'}/100${scoreArrow}  mood ${yesterday.mood_1_10 ?? '?'}/10${moodArrow}  RHR ${rhrCurrent ?? '?'}${rhrArrow}${clusterNote}`,
      `Focus ${yn(yesterday.no_escape_media)} (${yesterday.escape_media_minutes ?? '?'}m) · Eating ${yn(yesterday.fixed_eating)} (${yesterday.outside_window_meals ?? '?'} off-window) · Clean Eve ${yn(yesterday.clean_evening)}`,
      `Work ${yn(yesterday.work_win)} · Personal ${yn(yesterday.personal_win)} · Gym ${yn(yesterday.gym)}`,
      `Kids ${yn(yesterday.kids_quality)} · Bed ${yn(yesterday.bed_on_time)} (${bedTime})`,
    ].join('\n');
  }

  const trendLine = trend ? `Trend: ${trend}\n` : '';
  const wearableLine = wearable
    ? `Wearables (${wearable.date}): sleep ${formatSleepHours(wearable.sleep_hours)} · score ${wearable.sleep_score ?? '?'}`
    : 'Wearables: not synced';

  let targetsBlock = 'No targets set for today. Use /targets to add them.';
  if (targets) {
    targetsBlock = `Today's mission:\n→ Work: ${targets.work_target || '-'}\n→ Personal: ${targets.personal_target || '-'}`;
  }

  return `Morning.\n\n${scoreBlock}\n${wearableLine}\n${trendLine}\n${targetsBlock}`;
}

export function weeklyReviewIntro() {
  return `Sunday review.`;
}

export function todaySummary(log) {
  if (!log) return 'No check-in logged today yet.';
  const yn = v => v === 1 ? '✓' : v === 0 ? '✗' : '?';
  return [
    `Today (${log.date}): ${log.daily_score ?? '?'}/100  mood ${log.mood_1_10 ?? '?'}/10`,
    `Focus ${yn(log.no_escape_media)} (${log.escape_media_minutes ?? '?'}m) · Eating ${yn(log.fixed_eating)} (${log.outside_window_meals ?? '?'} off-window) · Clean Eve ${yn(log.clean_evening)}`,
    `Work ${yn(log.work_win)} · Personal ${yn(log.personal_win)} · Gym ${yn(log.gym)}`,
    `Kids ${yn(log.kids_quality)} · Bed ${log.bed_time_text || '?'}`,
    log.stress_note ? `\nNote: ${log.stress_note}` : '',
  ].join('\n');
}

export function weekSummary(logs) {
  if (logs.length === 0) return 'No data for the last 7 days.';
  const avg = (logs.reduce((s, r) => s + (r.daily_score || 0), 0) / logs.length).toFixed(1);
  const avgMood = logs.filter(l => l.mood_1_10).length > 0
    ? (logs.reduce((s, l) => s + (l.mood_1_10 || 0), 0) / logs.filter(l => l.mood_1_10).length).toFixed(1)
    : '?';
  const lines = logs.map(r => `${r.date}: ${r.daily_score ?? '?'}/100  mood ${r.mood_1_10 ?? '?'}/10`);
  return `Last ${logs.length} days:\n${lines.join('\n')}\n\nAvg: ${avg}/100  Avg mood: ${avgMood}/10`;
}
