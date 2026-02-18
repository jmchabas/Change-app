// --- Date helpers (always Hawaii time) ---

const TZ = 'Pacific/Honolulu';

export function getTodayHST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function getYesterdayHST() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function getWeekStartHST() {
  const now = new Date();
  const hstStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const d = new Date(hstStr + 'T00:00:00');
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

// --- Parser ---

export function parseLogMessage(text) {
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/);

  if (tokens.length < 7) {
    return {
      ok: false,
      error: `Expected 7 values, got ${tokens.length}.\n\nFormat: <SLEEP> <BED Y/N> <WORKOUT Y/N> <EAT Y/N> <BLOCK1 Y/N> <BLOCK2 Y/N> <ANCHOR Y/N>\nExample: 7.2 Y N Y Y Y N`,
    };
  }

  const sleepRaw = tokens[0];
  const sleepHours = parseFloat(sleepRaw);
  if (isNaN(sleepHours) || sleepHours < 0 || sleepHours > 14) {
    return { ok: false, error: `Sleep hours must be 0–14. Got: "${sleepRaw}"` };
  }

  const fields = ['Bed on time', 'Workout', 'Eating windows', 'Block 1', 'Block 2', 'Anchor'];
  const booleans = [];
  for (let i = 1; i <= 6; i++) {
    const v = tokens[i].toUpperCase();
    if (v !== 'Y' && v !== 'N') {
      return { ok: false, error: `"${fields[i - 1]}" must be Y or N. Got: "${tokens[i]}"` };
    }
    booleans.push(v === 'Y' ? 1 : 0);
  }

  const notes = tokens.length > 7 ? tokens.slice(7).join(' ') : '';
  const [bed_on_time, workout, eat_windows, block1, block2, anchor] = booleans;
  const scores = computeScores(sleepHours, booleans);

  return {
    ok: true,
    data: {
      date: getTodayHST(),
      sleep_hours: Math.round(sleepHours * 10) / 10,
      bed_on_time, workout, eat_windows, block1, block2, anchor,
      ...scores,
      notes,
    },
  };
}

// --- Scoring ---

export function computeScores(sleepHours, booleans) {
  const [bed, workout, eat, b1, b2, anchor] = booleans;
  const energy_score = (sleepHours >= 7.5 ? 1 : 0) + bed + workout + eat;
  const exec_score = b1 + b2;
  const life_score = anchor;
  return { energy_score, exec_score, life_score, total_score: energy_score + exec_score + life_score };
}

// --- Drift detection ---

export function detectDrift(logs) {
  if (logs.length === 0) return { drifts: [], biggest: 'None' };

  const n = logs.length;
  const sleepAvg = logs.reduce((s, r) => s + (r.sleep_hours || 0), 0) / n;
  const bedMisses = logs.filter(r => !r.bed_on_time).length;
  const foodMisses = logs.filter(r => !r.eat_windows).length;
  const workMisses = logs.filter(r => !r.block1).length + logs.filter(r => !r.block2).length;
  const socialMisses = logs.filter(r => !r.anchor).length;

  const drifts = [];
  if (sleepAvg < 7.0 || bedMisses >= 2)  drifts.push({ area: 'SLEEP',  severity: bedMisses + (sleepAvg < 7 ? 2 : 0) });
  if (foodMisses >= 2)                    drifts.push({ area: 'FOOD',   severity: foodMisses });
  if (workMisses >= 3)                    drifts.push({ area: 'WORK',   severity: workMisses });
  if (socialMisses >= 5)                  drifts.push({ area: 'SOCIAL', severity: socialMisses });

  drifts.sort((a, b) => b.severity - a.severity);
  return { drifts, biggest: drifts.length > 0 ? drifts[0].area : 'None' };
}

// --- Trend ---

export function computeTrend(logs) {
  if (logs.length < 5) return 'FLAT';
  const scores = logs.map(r => r.total_score);
  const recent = scores.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const older  = scores.slice(3).reduce((a, b) => a + b, 0) / scores.slice(3).length;
  if (recent > older + 0.3) return '↑ UP';
  if (recent < older - 0.3) return '↓ DOWN';
  return '→ FLAT';
}

// --- Weekly stats ---

export function computeWeeklyStats(logs) {
  if (logs.length === 0) return null;

  const avg = logs.reduce((s, r) => s + r.total_score, 0) / logs.length;
  let best = logs[0], worst = logs[0];
  for (const r of logs) {
    if (r.total_score > best.total_score) best = r;
    if (r.total_score < worst.total_score) worst = r;
  }
  const { biggest } = detectDrift(logs);

  const fixes = {
    SLEEP:  'Set a hard phone-down time 30 min before bed.',
    FOOD:   'Prep meals for your eating windows the night before.',
    WORK:   'Block 90 min tomorrow morning — phone on DND, no Slack.',
    SOCIAL: 'Text one friend today. Schedule one family activity this week.',
    None:   'Keep the consistency. Add one ambitious thing.',
  };

  return {
    week_start: getWeekStartHST(),
    avg_score: Math.round(avg * 10) / 10,
    best_day: best.date,
    best_score: best.total_score,
    worst_day: worst.date,
    worst_score: worst.total_score,
    biggest_drift: biggest,
    one_fix: fixes[biggest] || fixes.None,
  };
}
