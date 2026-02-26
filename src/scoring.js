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

  const m = str.match(/^(\d{1,2})([:.](\d{1,2}))?(am|pm)$/);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[3] != null ? Number(m[3]) : 0;
  const period = m[4];
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
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

export function computeDetailedScores(input) {
  const escapeMediaMinutes = boundedInt(input.escape_media_minutes, 0, 1440);
  const outsideMeals = boundedInt(input.outside_window_meals, 0, 20);
  const cleanEvening = input.clean_evening ? 1 : 0;
  const workWin = input.work_win ? 1 : 0;
  const personalWin = input.personal_win ? 1 : 0;
  const gym = input.gym ? 1 : 0;
  const kidsQuality = input.kids_quality ? 1 : 0;
  const bedTimeMinutes = parseUsTimeToMinutes(input.bed_time_text);
  const mood = boundedInt(input.mood_1_10, 1, 10) ?? 1;

  const escapeScore = scoreEscapeMedia(escapeMediaMinutes);
  const mealsScore = scoreOutsideMeals(outsideMeals);
  const cleanScore = cleanEvening ? 10 : 0;
  const workScore = workWin ? 10 : 0;
  const personalScore = personalWin ? 10 : 0;
  const gymScore = gym ? 10 : 0;
  const kidsScore = kidsQuality ? 10 : 0;
  const bedScore = scoreBedtime(bedTimeMinutes);

  const behaviorScore = escapeScore + mealsScore + cleanScore + workScore + personalScore + gymScore + kidsScore + bedScore; // /80
  const stateScore = mood * 2; // /20
  const dailyScore = behaviorScore + stateScore; // /100

  // Keep legacy 0/8 score for backwards compatibility.
  const legacyPasses = {
    no_escape_media: escapeScore >= 6 ? 1 : 0,
    fixed_eating: mealsScore >= 6 ? 1 : 0,
    clean_evening: cleanEvening,
    work_win: workWin,
    personal_win: personalWin,
    gym,
    kids_quality: kidsQuality,
    bed_on_time: bedScore >= 8 ? 1 : 0,
  };
  const legacyScore = Object.values(legacyPasses).reduce((a, b) => a + b, 0);

  return {
    escape_media_minutes: escapeMediaMinutes,
    outside_window_meals: outsideMeals,
    clean_evening: cleanEvening,
    work_win: workWin,
    personal_win: personalWin,
    gym,
    kids_quality: kidsQuality,
    bed_time_minutes: bedTimeMinutes,
    mood_1_10: mood,
    behavior_score: behaviorScore,
    state_score: stateScore,
    daily_score: dailyScore,
    no_escape_media: legacyPasses.no_escape_media,
    fixed_eating: legacyPasses.fixed_eating,
    bed_on_time: legacyPasses.bed_on_time,
    total_score: legacyScore,
    mood: Math.max(1, Math.min(5, Math.round(mood / 2))),
  };
}
