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
  const scores = logs.map((r) => (r.daily_score ?? r.total_score ?? 0));
  const recent = scores.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const older = scores.slice(3).reduce((a, b) => a + b, 0) / scores.slice(3).length;
  if (recent > older + 0.3) return '↑ UP';
  if (recent < older - 0.3) return '↓ DOWN';
  return '→ FLAT';
}

export function parseUsTimeToMinutes(value) {
  if (!value) return null;
  const str = String(value).trim().toLowerCase().replace(/\s+/g, '');

  // 12-hour clock with optional am/pm (for convenience in bedtime input).
  const m12 = str.match(/^(\d{1,2})([:.](\d{1,2}))?(am|pm)?$/);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = m12[3] != null ? Number(m12[3]) : 0;
    let period = m12[4] || null;
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    // If period is missing, bedtime defaults to PM for common evening hours.
    if (!period) period = hour >= 4 && hour <= 11 ? 'pm' : 'am';

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  // 24-hour fallback (e.g. 21:30)
  const m24 = str.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  if (m24) {
    const hour = Number(m24[1]);
    const minute = Number(m24[2]);
    return hour * 60 + minute;
  }
  return null;
}

function boundedInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function scoreEscapeMedia(minutes) {
  if (minutes == null) return 0;
  if (minutes === 0) return 10;
  if (minutes <= 15) return 8;
  if (minutes <= 30) return 6;
  if (minutes <= 60) return 3;
  return 0;
}

function scoreOutsideMeals(count) {
  if (count == null) return 0;
  if (count <= 0) return 10;
  if (count === 1) return 6;
  if (count === 2) return 3;
  return 0;
}

function scoreBedtime(bedMinutes, targetMinutes = 21 * 60 + 30) {
  if (bedMinutes == null) return 0;

  const delta = bedMinutes - targetMinutes;
  if (delta <= 0) return 10;
  if (delta <= 30) return 8;
  if (delta <= 60) return 5;
  if (delta <= 90) return 2;
  return 0;
}

function normalizeBinary(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}

function isWeekendDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 6 || day === 0;
}

export function computeDetailedScores(input) {
  const escapeMediaMinutes = boundedInt(input.escape_media_minutes, 0, 1440);
  const outsideMeals = boundedInt(input.outside_window_meals, 0, 20);
  const cleanEvening = normalizeBinary(input.clean_evening) === 1 ? 1 : 0;
  const workRaw = normalizeBinary(input.work_win);
  const personalRaw = normalizeBinary(input.personal_win);
  const gym = normalizeBinary(input.gym) === 1 ? 1 : 0;
  const kidsQuality = normalizeBinary(input.kids_quality) === 1 ? 1 : 0;
  const bedTimeMinutes = parseUsTimeToMinutes(input.bed_time_text);
  const mood = boundedInt(input.mood_1_10, 1, 10) ?? 1;
  const weekend = isWeekendDate(input.date);

  const escapeScore = scoreEscapeMedia(escapeMediaMinutes);
  const mealsScore = scoreOutsideMeals(outsideMeals);
  const cleanScore = cleanEvening ? 10 : 0;
  const gymScore = gym ? 10 : 0;
  const kidsScore = kidsQuality ? 10 : 0;
  const workActive = weekend ? workRaw === 1 : true;
  const personalActive = weekend ? personalRaw === 1 : true;
  const bedActive = weekend ? bedTimeMinutes != null : true;
  const workWin = workRaw == null ? null : workRaw;
  const personalWin = personalRaw == null ? null : personalRaw;
  const workScore = workActive ? (workWin === 1 ? 10 : 0) : 0;
  const personalScore = personalActive ? (personalWin === 1 ? 10 : 0) : 0;
  const bedScore = bedActive ? scoreBedtime(bedTimeMinutes) : 0;

  const behaviorScore = escapeScore + mealsScore + cleanScore + workScore + personalScore + gymScore + kidsScore + bedScore;
  const stateScore = mood * 2; // /20
  const earnedPoints = behaviorScore + stateScore;
  const activePossiblePoints = weekend
    ? 70 + (workActive ? 10 : 0) + (personalActive ? 10 : 0) + (bedActive ? 10 : 0)
    : 100;
  const dailyScore = activePossiblePoints > 0
    ? (weekend
      ? Math.round((earnedPoints / activePossiblePoints) * 1000) / 10
      : earnedPoints)
    : 0;

  // Keep legacy 0/8 score for backwards compatibility.
  const legacyPasses = {
    no_escape_media: escapeScore >= 6 ? 1 : 0,
    fixed_eating: mealsScore >= 6 ? 1 : 0,
    clean_evening: cleanEvening,
    work_win: workActive ? (workWin === 1 ? 1 : 0) : null,
    personal_win: personalActive ? (personalWin === 1 ? 1 : 0) : null,
    gym,
    kids_quality: kidsQuality,
    bed_on_time: bedActive ? (bedScore >= 8 ? 1 : 0) : null,
  };
  const legacyScore = Object.values(legacyPasses).reduce((a, b) => a + (b === 1 ? 1 : 0), 0);

  return {
    date: input.date ?? null,
    is_weekend: weekend,
    escape_media_minutes: escapeMediaMinutes,
    outside_window_meals: outsideMeals,
    clean_evening: cleanEvening,
    work_win: workActive ? (workWin === 1 ? 1 : 0) : null,
    personal_win: personalActive ? (personalWin === 1 ? 1 : 0) : null,
    gym,
    kids_quality: kidsQuality,
    bed_time_text: input.bed_time_text || '',
    bed_time_minutes: bedTimeMinutes,
    mood_1_10: mood,
    behavior_score: behaviorScore,
    state_score: stateScore,
    earned_points: earnedPoints,
    active_possible_points: activePossiblePoints,
    daily_score: dailyScore,
    no_escape_media: legacyPasses.no_escape_media,
    fixed_eating: legacyPasses.fixed_eating,
    bed_on_time: legacyPasses.bed_on_time,
    total_score: legacyScore,
    mood: Math.max(1, Math.min(5, Math.round(mood / 2))),
  };
}
