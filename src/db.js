import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'lifeos.db');

let db;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_log (
      date         TEXT PRIMARY KEY,
      sleep_hours  REAL,
      bed_on_time  INTEGER,
      workout      INTEGER,
      eat_windows  INTEGER,
      block1       INTEGER,
      block2       INTEGER,
      anchor       INTEGER,
      energy_score INTEGER,
      exec_score   INTEGER,
      life_score   INTEGER,
      total_score  INTEGER,
      notes        TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_review (
      week_start   TEXT PRIMARY KEY,
      avg_score    REAL,
      best_day     TEXT,
      best_score   INTEGER,
      worst_day    TEXT,
      worst_score  INTEGER,
      biggest_drift TEXT,
      one_fix      TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
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

export function getChatId() {
  return getSetting('chat_id');
}

export function setChatId(id) {
  setSetting('chat_id', String(id));
}

// --- Daily Log ---

export function upsertDailyLog(data) {
  getDb().prepare(`
    INSERT INTO daily_log (date, sleep_hours, bed_on_time, workout, eat_windows,
      block1, block2, anchor, energy_score, exec_score, life_score, total_score, notes)
    VALUES (@date, @sleep_hours, @bed_on_time, @workout, @eat_windows,
      @block1, @block2, @anchor, @energy_score, @exec_score, @life_score, @total_score, @notes)
    ON CONFLICT(date) DO UPDATE SET
      sleep_hours = @sleep_hours, bed_on_time = @bed_on_time, workout = @workout,
      eat_windows = @eat_windows, block1 = @block1, block2 = @block2, anchor = @anchor,
      energy_score = @energy_score, exec_score = @exec_score,
      life_score = @life_score, total_score = @total_score,
      notes = CASE WHEN @notes = '' THEN daily_log.notes ELSE @notes END,
      updated_at = datetime('now')
  `).run(data);
}

export function getDailyLog(date) {
  return getDb().prepare('SELECT * FROM daily_log WHERE date = ?').get(date);
}

export function getRecentLogs(days = 7) {
  return getDb().prepare(
    'SELECT * FROM daily_log ORDER BY date DESC LIMIT ?'
  ).all(days);
}

export function getAllLogs() {
  return getDb().prepare('SELECT * FROM daily_log ORDER BY date DESC').all();
}

// --- Weekly Review ---

export function insertWeeklyReview(data) {
  getDb().prepare(`
    INSERT INTO weekly_review (week_start, avg_score, best_day, best_score,
      worst_day, worst_score, biggest_drift, one_fix)
    VALUES (@week_start, @avg_score, @best_day, @best_score,
      @worst_day, @worst_score, @biggest_drift, @one_fix)
    ON CONFLICT(week_start) DO UPDATE SET
      avg_score = @avg_score, best_day = @best_day, best_score = @best_score,
      worst_day = @worst_day, worst_score = @worst_score,
      biggest_drift = @biggest_drift, one_fix = @one_fix
  `).run(data);
}

export function getRecentReviews(count = 4) {
  return getDb().prepare(
    'SELECT * FROM weekly_review ORDER BY week_start DESC LIMIT ?'
  ).all(count);
}
