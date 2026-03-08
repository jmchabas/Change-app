import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { computeDetailedScores } from './scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '..', 'lifeos.db');
const TZ = process.env.TZ || 'America/Los_Angeles';

let db;

function ensureDailyLogColumns() {
  const cols = getDb().prepare("PRAGMA table_info('daily_log')").all().map((c) => c.name);
  const needed = [
    ['escape_media_minutes', 'INTEGER'],
    ['outside_window_meals', 'INTEGER'],
    ['clean_evening_alcohol', 'INTEGER'],
    ['clean_evening_weed', 'INTEGER'],
    ['clean_evening_other_text', "TEXT DEFAULT ''"],
    ['gym_type', "TEXT DEFAULT ''"],
    ['kids_quality_note', "TEXT DEFAULT ''"],
    ['bed_time_text', "TEXT DEFAULT ''"],
    ['bed_time_minutes', 'INTEGER'],
    ['mood_1_10', 'INTEGER'],
    ['behavior_score', 'REAL'],
    ['state_score', 'REAL'],
    ['daily_score', 'REAL'],
    ['checkin_completed_at', 'TEXT'],
    ['coffee', 'INTEGER'],
    ['adhd_meds', 'INTEGER'],
    ['gut_bacteria_mgr', 'INTEGER'],
    ['gut_mvmt', 'INTEGER'],
  ];

  for (const [name, type] of needed) {
    if (!cols.includes(name)) {
      getDb().exec(`ALTER TABLE daily_log ADD COLUMN ${name} ${type};`);
    }
  }
}

function repairHistoricalBedtimeScoring() {
  const rows = getDb().prepare(`
    SELECT
      date,
      escape_media_minutes,
      outside_window_meals,
      clean_evening,
      work_win,
      personal_win,
      gym,
      kids_quality,
      bed_time_text,
      mood_1_10,
      mood,
      no_escape_media,
      fixed_eating,
      bed_on_time,
      total_score,
      behavior_score,
      state_score,
      daily_score,
      bed_time_minutes
    FROM daily_log
    WHERE checkin_completed_at IS NOT NULL
  `).all();

  const updateStmt = getDb().prepare(`
    UPDATE daily_log SET
      no_escape_media = @no_escape_media,
      fixed_eating = @fixed_eating,
      bed_on_time = @bed_on_time,
      total_score = @total_score,
      mood = @mood,
      behavior_score = @behavior_score,
      state_score = @state_score,
      daily_score = @daily_score,
      bed_time_minutes = @bed_time_minutes,
      updated_at = datetime('now')
    WHERE date = @date
  `);

  let updated = 0;
  for (const row of rows) {
    const scored = computeDetailedScores({
      date: row.date,
      escape_media_minutes: row.escape_media_minutes,
      outside_window_meals: row.outside_window_meals,
      clean_evening: row.clean_evening,
      work_win: row.work_win,
      personal_win: row.personal_win,
      gym: row.gym,
      kids_quality: row.kids_quality,
      bed_time_text: row.bed_time_text || '',
      mood_1_10: row.mood_1_10 ?? (row.mood != null ? row.mood * 2 : null),
    });

    // Only repair rows where bedtime can now be parsed.
    if (scored.bed_time_minutes == null) continue;

    const changed =
      row.no_escape_media !== scored.no_escape_media ||
      row.fixed_eating !== scored.fixed_eating ||
      row.bed_on_time !== scored.bed_on_time ||
      row.total_score !== scored.total_score ||
      row.mood !== scored.mood ||
      row.behavior_score !== scored.behavior_score ||
      row.state_score !== scored.state_score ||
      row.daily_score !== scored.daily_score ||
      row.bed_time_minutes !== scored.bed_time_minutes;

    if (!changed) continue;

    updateStmt.run({
      date: row.date,
      no_escape_media: scored.no_escape_media,
      fixed_eating: scored.fixed_eating,
      bed_on_time: scored.bed_on_time,
      total_score: scored.total_score,
      mood: scored.mood,
      behavior_score: scored.behavior_score,
      state_score: scored.state_score,
      daily_score: scored.daily_score,
      bed_time_minutes: scored.bed_time_minutes,
    });
    updated++;
  }

  if (updated > 0) {
    console.log(`Repaired historical bedtime scoring rows: ${updated}`);
  }
}

function dateFromIsoInTz(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function repairNullDateLogs() {
  const rows = getDb().prepare(`
    SELECT rowid, *
    FROM daily_log
    WHERE date IS NULL
    ORDER BY checkin_completed_at DESC, created_at DESC
  `).all();

  if (!rows.length) return;

  const updateDateStmt = getDb().prepare('UPDATE daily_log SET date = ?, updated_at = datetime(\'now\') WHERE rowid = ?');
  const deleteRowStmt = getDb().prepare('DELETE FROM daily_log WHERE rowid = ?');
  const findByDateStmt = getDb().prepare('SELECT rowid, checkin_completed_at FROM daily_log WHERE date = ?');
  const upsertStmt = getDb().prepare(`
    INSERT INTO daily_log (
      date, no_escape_media, fixed_eating, clean_evening, work_win, personal_win, gym, kids_quality,
      bed_on_time, total_score, mood, stress_note, created_at, updated_at,
      escape_media_minutes, outside_window_meals, clean_evening_alcohol, clean_evening_weed, clean_evening_other_text,
      gym_type, kids_quality_note, bed_time_text, bed_time_minutes, mood_1_10,
      behavior_score, state_score, daily_score, checkin_completed_at,
      coffee, adhd_meds, gut_bacteria_mgr, gut_mvmt
    ) VALUES (
      @date, @no_escape_media, @fixed_eating, @clean_evening, @work_win, @personal_win, @gym, @kids_quality,
      @bed_on_time, @total_score, @mood, @stress_note, @created_at, datetime('now'),
      @escape_media_minutes, @outside_window_meals, @clean_evening_alcohol, @clean_evening_weed, @clean_evening_other_text,
      @gym_type, @kids_quality_note, @bed_time_text, @bed_time_minutes, @mood_1_10,
      @behavior_score, @state_score, @daily_score, @checkin_completed_at,
      @coffee, @adhd_meds, @gut_bacteria_mgr, @gut_mvmt
    )
    ON CONFLICT(date) DO UPDATE SET
      no_escape_media = excluded.no_escape_media,
      fixed_eating = excluded.fixed_eating,
      clean_evening = excluded.clean_evening,
      work_win = excluded.work_win,
      personal_win = excluded.personal_win,
      gym = excluded.gym,
      kids_quality = excluded.kids_quality,
      bed_on_time = excluded.bed_on_time,
      total_score = excluded.total_score,
      mood = excluded.mood,
      stress_note = excluded.stress_note,
      escape_media_minutes = excluded.escape_media_minutes,
      outside_window_meals = excluded.outside_window_meals,
      clean_evening_alcohol = excluded.clean_evening_alcohol,
      clean_evening_weed = excluded.clean_evening_weed,
      clean_evening_other_text = excluded.clean_evening_other_text,
      gym_type = excluded.gym_type,
      kids_quality_note = excluded.kids_quality_note,
      bed_time_text = excluded.bed_time_text,
      bed_time_minutes = excluded.bed_time_minutes,
      mood_1_10 = excluded.mood_1_10,
      behavior_score = excluded.behavior_score,
      state_score = excluded.state_score,
      daily_score = excluded.daily_score,
      checkin_completed_at = excluded.checkin_completed_at,
      coffee = excluded.coffee,
      adhd_meds = excluded.adhd_meds,
      gut_bacteria_mgr = excluded.gut_bacteria_mgr,
      gut_mvmt = excluded.gut_mvmt,
      updated_at = datetime('now')
  `);

  let repaired = 0;
  for (const row of rows) {
    const guessedDate = dateFromIsoInTz(row.checkin_completed_at || row.created_at);
    if (!guessedDate) continue;

    const existing = findByDateStmt.get(guessedDate);
    if (!existing) {
      updateDateStmt.run(guessedDate, row.rowid);
      repaired++;
      continue;
    }

    // Conflict: keep the newer completion for that day.
    const rowTs = Date.parse(row.checkin_completed_at || row.created_at || '');
    const existingTs = Date.parse(existing.checkin_completed_at || '');
    if (Number.isFinite(rowTs) && (!Number.isFinite(existingTs) || rowTs >= existingTs)) {
      upsertStmt.run({
        ...row,
        date: guessedDate,
      });
    }
    deleteRowStmt.run(row.rowid);
    repaired++;
  }

  if (repaired > 0) {
    console.log(`Repaired null-date daily_log rows: ${repaired}`);
  }
}

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_log (
      date              TEXT PRIMARY KEY,
      no_escape_media   INTEGER,
      fixed_eating      INTEGER,
      clean_evening     INTEGER,
      work_win          INTEGER,
      personal_win      INTEGER,
      gym               INTEGER,
      kids_quality      INTEGER,
      bed_on_time       INTEGER,
      total_score       INTEGER,
      mood              INTEGER,
      stress_note       TEXT DEFAULT '',
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deliverables (
      date              TEXT PRIMARY KEY,
      work_target       TEXT DEFAULT '',
      personal_target   TEXT DEFAULT '',
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS break_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      date              TEXT NOT NULL,
      habit             TEXT NOT NULL,
      reason            TEXT NOT NULL,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_review (
      week_start        TEXT PRIMARY KEY,
      avg_score         REAL,
      avg_mood          REAL,
      coaching_text     TEXT,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wearable_metrics (
      date              TEXT PRIMARY KEY,
      source            TEXT DEFAULT 'fitbit',
      resting_hr        INTEGER,
      sleep_hours       REAL,
      sleep_score       REAL,
      raw_sleep_json    TEXT,
      raw_heart_json    TEXT,
      synced_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key               TEXT PRIMARY KEY,
      value             TEXT
    );
  `);

  ensureDailyLogColumns();
  repairNullDateLogs();
  repairHistoricalBedtimeScoring();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized — call initDb() first');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// --- Settings ---

export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

export function deleteSetting(key) {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

const CLAIM_TTL_MS = 15 * 60 * 1000;

export function claimDailySetting(prefix, date) {
  const key = `${prefix}:${date}`;
  const now = Date.now();
  const claimValue = `claim:${now}`;
  const existing = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);

  if (!existing) {
    const out = getDb().prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?)'
    ).run(key, claimValue);
    return out.changes === 1;
  }

  const current = String(existing.value || '');
  if (current === '1') return false;

  if (current.startsWith('claim:')) {
    const ts = Number(current.slice('claim:'.length));
    const stale = !Number.isFinite(ts) || (now - ts) > CLAIM_TTL_MS;
    if (!stale) return false;
    getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run(claimValue, key);
    return true;
  }

  // Unknown value type: do not claim.
  return false;
}

export function releaseDailyClaim(prefix, date) {
  const key = `${prefix}:${date}`;
  getDb().prepare("DELETE FROM settings WHERE key = ? AND value LIKE 'claim:%'").run(key);
}

export function getChatId() { return getSetting('chat_id'); }
export function setChatId(id) { setSetting('chat_id', String(id)); }

// --- Daily Log ---

export function upsertDailyLog(data) {
  getDb().prepare(`
    INSERT INTO daily_log (date, no_escape_media, fixed_eating, clean_evening,
      work_win, personal_win, gym, kids_quality, bed_on_time, total_score, mood, stress_note,
      escape_media_minutes, outside_window_meals, clean_evening_alcohol, clean_evening_weed, clean_evening_other_text,
      gym_type, kids_quality_note, bed_time_text, bed_time_minutes, mood_1_10,
      behavior_score, state_score, daily_score, checkin_completed_at,
      coffee, adhd_meds, gut_bacteria_mgr, gut_mvmt)
    VALUES (@date, @no_escape_media, @fixed_eating, @clean_evening,
      @work_win, @personal_win, @gym, @kids_quality, @bed_on_time, @total_score, @mood, @stress_note,
      @escape_media_minutes, @outside_window_meals, @clean_evening_alcohol, @clean_evening_weed, @clean_evening_other_text,
      @gym_type, @kids_quality_note, @bed_time_text, @bed_time_minutes, @mood_1_10,
      @behavior_score, @state_score, @daily_score, @checkin_completed_at,
      @coffee, @adhd_meds, @gut_bacteria_mgr, @gut_mvmt)
    ON CONFLICT(date) DO UPDATE SET
      no_escape_media = @no_escape_media, fixed_eating = @fixed_eating,
      clean_evening = @clean_evening, work_win = @work_win, personal_win = @personal_win,
      gym = @gym, kids_quality = @kids_quality, bed_on_time = @bed_on_time,
      total_score = @total_score, mood = @mood,
      stress_note = CASE WHEN @stress_note = '' THEN daily_log.stress_note ELSE @stress_note END,
      escape_media_minutes = @escape_media_minutes,
      outside_window_meals = @outside_window_meals,
      clean_evening_alcohol = @clean_evening_alcohol,
      clean_evening_weed = @clean_evening_weed,
      clean_evening_other_text = @clean_evening_other_text,
      gym_type = @gym_type,
      kids_quality_note = @kids_quality_note,
      bed_time_text = @bed_time_text,
      bed_time_minutes = @bed_time_minutes,
      mood_1_10 = @mood_1_10,
      behavior_score = @behavior_score,
      state_score = @state_score,
      daily_score = @daily_score,
      checkin_completed_at = @checkin_completed_at,
      coffee = @coffee,
      adhd_meds = @adhd_meds,
      gut_bacteria_mgr = @gut_bacteria_mgr,
      gut_mvmt = @gut_mvmt,
      updated_at = datetime('now')
  `).run({
    stress_note: '',
    escape_media_minutes: null,
    outside_window_meals: null,
    clean_evening_alcohol: 0,
    clean_evening_weed: 0,
    clean_evening_other_text: '',
    gym_type: '',
    kids_quality_note: '',
    bed_time_text: '',
    bed_time_minutes: null,
    mood_1_10: null,
    behavior_score: null,
    state_score: null,
    daily_score: null,
    checkin_completed_at: null,
    coffee: 0,
    adhd_meds: 0,
    gut_bacteria_mgr: 0,
    gut_mvmt: 0,
    ...data,
  });
}

export function getDailyLog(date) {
  return getDb().prepare('SELECT * FROM daily_log WHERE date = ?').get(date);
}

export function getRecentLogs(days = 7) {
  return getDb().prepare('SELECT * FROM daily_log ORDER BY date DESC LIMIT ?').all(days);
}

export function getAllLogs() {
  return getDb().prepare('SELECT * FROM daily_log ORDER BY date DESC').all();
}

// --- Wearable Metrics ---

export function upsertWearableMetrics(data) {
  getDb().prepare(`
    INSERT INTO wearable_metrics (date, source, resting_hr, sleep_hours, sleep_score, raw_sleep_json, raw_heart_json, synced_at)
    VALUES (@date, @source, @resting_hr, @sleep_hours, @sleep_score, @raw_sleep_json, @raw_heart_json, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET
      source = @source,
      resting_hr = @resting_hr,
      sleep_hours = @sleep_hours,
      sleep_score = @sleep_score,
      raw_sleep_json = @raw_sleep_json,
      raw_heart_json = @raw_heart_json,
      synced_at = datetime('now')
  `).run({
    source: 'fitbit',
    raw_sleep_json: '',
    raw_heart_json: '',
    ...data,
  });
}

export function getWearableMetrics(date) {
  return getDb().prepare('SELECT * FROM wearable_metrics WHERE date = ?').get(date);
}

export function getRecentWearableMetrics(days = 14) {
  return getDb().prepare(
    'SELECT * FROM wearable_metrics ORDER BY date DESC LIMIT ?'
  ).all(days);
}

// --- Deliverables ---

export function upsertDeliverables(date, workTarget, personalTarget) {
  getDb().prepare(`
    INSERT INTO deliverables (date, work_target, personal_target)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET work_target = ?, personal_target = ?
  `).run(date, workTarget, personalTarget, workTarget, personalTarget);
}

export function getDeliverables(date) {
  return getDb().prepare('SELECT * FROM deliverables WHERE date = ?').get(date);
}

// --- Break Log ---

export function insertBreakLogs(date, breakReasons) {
  const stmt = getDb().prepare('INSERT INTO break_log (date, habit, reason) VALUES (?, ?, ?)');
  for (const { habit, reason } of breakReasons) {
    stmt.run(date, habit, reason);
  }
}

export function getBreakLogs(days = 7) {
  return getDb().prepare(
    'SELECT * FROM break_log ORDER BY created_at DESC LIMIT ?'
  ).all(days * 4);
}

// --- Weekly Review ---

export function insertWeeklyReview(data) {
  getDb().prepare(`
    INSERT INTO weekly_review (week_start, avg_score, avg_mood, coaching_text)
    VALUES (@week_start, @avg_score, @avg_mood, @coaching_text)
    ON CONFLICT(week_start) DO UPDATE SET
      avg_score = @avg_score, avg_mood = @avg_mood, coaching_text = @coaching_text
  `).run(data);
}

export function getRecentReviews(count = 4) {
  return getDb().prepare('SELECT * FROM weekly_review ORDER BY week_start DESC LIMIT ?').all(count);
}
