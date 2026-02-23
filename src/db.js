import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '..', 'lifeos.db');

let db;

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

    CREATE TABLE IF NOT EXISTS settings (
      key               TEXT PRIMARY KEY,
      value             TEXT
    );
  `);

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized — call initDb() first');
  return db;
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

export function getChatId() { return getSetting('chat_id'); }
export function setChatId(id) { setSetting('chat_id', String(id)); }

// --- Daily Log ---

export function upsertDailyLog(data) {
  getDb().prepare(`
    INSERT INTO daily_log (date, no_escape_media, fixed_eating, clean_evening,
      work_win, personal_win, gym, kids_quality, bed_on_time, total_score, mood, stress_note)
    VALUES (@date, @no_escape_media, @fixed_eating, @clean_evening,
      @work_win, @personal_win, @gym, @kids_quality, @bed_on_time, @total_score, @mood, @stress_note)
    ON CONFLICT(date) DO UPDATE SET
      no_escape_media = @no_escape_media, fixed_eating = @fixed_eating,
      clean_evening = @clean_evening, work_win = @work_win, personal_win = @personal_win,
      gym = @gym, kids_quality = @kids_quality, bed_on_time = @bed_on_time,
      total_score = @total_score, mood = @mood,
      stress_note = CASE WHEN @stress_note = '' THEN daily_log.stress_note ELSE @stress_note END,
      updated_at = datetime('now')
  `).run(data);
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
