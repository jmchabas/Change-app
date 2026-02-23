// --- Date helpers (always Hawaii time) ---

const TZ = process.env.TZ || 'America/Los_Angeles';

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

export function getTomorrowHST() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
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

// --- Scoring ---

const HABIT_FIELDS = [
  'no_escape_media', 'fixed_eating', 'clean_evening',
  'work_win', 'personal_win', 'gym', 'kids_quality', 'bed_on_time',
];

export function computeScore(habits) {
  return HABIT_FIELDS.reduce((sum, f) => sum + (habits[f] === 1 ? 1 : 0), 0);
}

// --- Trend ---

export function computeTrend(logs) {
  if (logs.length < 5) return null;
  const scores = logs.map(r => r.total_score || 0);
  const recent = scores.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const older = scores.slice(3).reduce((a, b) => a + b, 0) / scores.slice(3).length;
  if (recent > older + 0.3) return '↑ UP';
  if (recent < older - 0.3) return '↓ DOWN';
  return '→ FLAT';
}
