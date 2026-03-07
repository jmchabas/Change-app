import { Router } from 'express';
import * as db from './db.js';
import { getTodayHST, computeTrend, computeDetailedScores } from './scoring.js';
import {
  getFitbitAuthUrl,
  handleFitbitCallback,
  getFitbitStatus,
  syncRecentFitbitData,
} from './fitbit.js';
import { verifyCheckinToken } from './checkin-link.js';
import { createCheckinToken } from './checkin-link.js';
import { startReflectionForUser } from './bot.js';

const router = Router();
const TZ = process.env.TZ || 'America/Los_Angeles';

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function sanitizeWearable(row) {
  if (!row) return null;
  const { raw_sleep_json, raw_heart_json, ...safe } = row;
  return safe;
}

function parseBoolOrNull(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

router.get('/api/today', (req, res) => {
  const today = getTodayHST();
  const log = db.getDailyLog(today);
  const targets = db.getDeliverables(today);
  const wearable = sanitizeWearable(db.getWearableMetrics(today));
  res.json({ date: today, log: log || null, targets: targets || null, wearable: wearable || null });
});

router.get('/api/week', (req, res) => {
  const logs = db.getRecentLogs(7);
  const wearables = db.getRecentWearableMetrics(7).map(sanitizeWearable);
  const trend = computeTrend(logs);
  const avg = logs.length > 0
    ? Math.round((logs.reduce((s, r) => s + (r.daily_score ?? r.total_score ?? 0), 0) / logs.length) * 10) / 10
    : null;
  const avgMood = logs.filter(l => l.mood_1_10).length > 0
    ? Math.round((logs.reduce((s, l) => s + (l.mood_1_10 || 0), 0) / logs.filter(l => l.mood_1_10).length) * 10) / 10
    : null;
  res.json({ logs, wearables, trend, avg, avgMood });
});

router.get('/api/wearables/history', (req, res) => {
  const daysRaw = Number(req.query.days);
  const days = Number.isFinite(daysRaw) && daysRaw > 0
    ? Math.min(Math.round(daysRaw), 365)
    : 60;
  const wearables = db.getRecentWearableMetrics(days).map(sanitizeWearable);
  res.json({ wearables, days });
});

router.get('/api/history', (req, res) => {
  const logs = db.getAllLogs();
  res.json({ logs });
});

router.get('/api/reviews', (req, res) => {
  const reviews = db.getRecentReviews(8);
  res.json({ reviews });
});

router.get('/api/breaks', (req, res) => {
  const breaks = db.getBreakLogs(30);
  res.json({ breaks });
});

router.get('/api/integrations', (req, res) => {
  res.json({
    timezone: TZ,
    fitbit: getFitbitStatus(),
  });
});

router.post('/api/fitbit/sync-now', async (req, res) => {
  try {
    const result = await syncRecentFitbitData(3);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/checkin/latest-link', (req, res) => {
  const chatId = db.getChatId();
  if (!chatId) {
    res.json({
      ok: true,
      available: false,
      reason: 'No Telegram chat registered yet. Send /start to your bot first.',
    });
    return;
  }

  const date = getTodayHST();
  const token = createCheckinToken({ chatId, date, ttlHours: 24 });
  const baseUrl = getBaseUrl(req).replace(/\/$/, '');
  const link = `${baseUrl}/checkin?token=${encodeURIComponent(token)}`;

  res.json({
    ok: true,
    available: true,
    date,
    link,
  });
});

router.get('/auth/fitbit/start', (req, res) => {
  try {
    const url = getFitbitAuthUrl(getBaseUrl(req));
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`Fitbit auth unavailable: ${err.message}`);
  }
});

router.get('/auth/fitbit/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    res.status(400).send('Missing Fitbit OAuth query params');
    return;
  }

  try {
    await handleFitbitCallback({ code, state, baseUrl: getBaseUrl(req) });
    res.send(
      '<h2>Fitbit connected</h2><p>You can close this tab and return to LifeOS.</p><p><a href="/">Back to dashboard</a></p>'
    );
  } catch (err) {
    res.status(500).send(`Fitbit callback failed: ${err.message}`);
  }
});

router.get('/checkin', (req, res) => {
  // Public static file handles the UI. Token stays in query string.
  res.redirect(`/checkin.html${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
});

router.get('/api/checkin/form', (req, res) => {
  try {
    const payload = verifyCheckinToken(req.query.token);
    const date = payload.date;
    const log = db.getDailyLog(date);
    const targets = db.getDeliverables(date);
    res.json({
      ok: true,
      date,
      targets: targets || null,
      log: log || null,
    });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

router.post('/api/checkin/submit', async (req, res) => {
  try {
    const { token, form } = req.body || {};
    const payload = verifyCheckinToken(token);
    const date = payload.date;
    const chatId = payload.chatId;

    const cleanEvening = parseBoolOrNull(form?.clean_evening) === true;
    const gym = parseBoolOrNull(form?.gym) === true;
    const kidsQuality = parseBoolOrNull(form?.kids_quality) === true;
    const workWin = parseBoolOrNull(form?.work_win);
    const personalWin = parseBoolOrNull(form?.personal_win);
    const subs = Array.isArray(form?.clean_evening_substances) ? form.clean_evening_substances : [];
    const supportStack = Array.isArray(form?.support_stack) ? form.support_stack : [];

    const scored = computeDetailedScores({
      date,
      escape_media_minutes: form?.escape_media_minutes,
      outside_window_meals: form?.outside_window_meals,
      clean_evening: cleanEvening,
      work_win: workWin,
      personal_win: personalWin,
      gym,
      kids_quality: kidsQuality,
      bed_time_text: form?.bed_time_text,
      mood_1_10: form?.mood_1_10,
    });

    const breakReasons = [];
    if (scored.no_escape_media === 0) breakReasons.push({ habit: 'no_escape_media', reason: `${scored.escape_media_minutes ?? '?'} min escape media` });
    if (scored.fixed_eating === 0) breakReasons.push({ habit: 'fixed_eating', reason: `${scored.outside_window_meals ?? '?'} meals outside windows` });
    if (!cleanEvening) breakReasons.push({ habit: 'clean_evening', reason: `Substances: ${(subs.join(', ') || 'unspecified')}` });
    if (scored.work_win === 0) breakReasons.push({ habit: 'work_win', reason: 'Work target not achieved' });
    if (scored.personal_win === 0) breakReasons.push({ habit: 'personal_win', reason: 'Personal target not achieved' });

    db.upsertDailyLog({
      ...scored,
      date,
      clean_evening_alcohol: subs.includes('Alcohol') ? 1 : 0,
      clean_evening_weed: subs.includes('Weed') ? 1 : 0,
      clean_evening_other_text: form?.clean_evening_other_text || '',
      gym_type: form?.gym_type || '',
      kids_quality_note: kidsQuality ? (form?.kids_quality_note || '') : '',
      bed_time_text: form?.bed_time_text || '',
      mood_1_10: scored.mood_1_10,
      checkin_completed_at: new Date().toISOString(),
      stress_note: form?.stress_note || '',
      coffee: supportStack.includes('coffee') ? 1 : 0,
      adhd_meds: supportStack.includes('adhd_meds') ? 1 : 0,
      gut_bacteria_mgr: supportStack.includes('gut_bacteria_mgr') ? 1 : 0,
      gut_mvmt: supportStack.includes('gut_mvmt') ? 1 : 0,
    });

    if (breakReasons.length > 0) {
      db.insertBreakLogs(date, breakReasons);
    }

    const reflectionContext = {
      ...scored,
      date,
      clean_evening: cleanEvening ? 1 : 0,
      clean_evening_substances: subs.join(', '),
      work_win: scored.work_win,
      personal_win: scored.personal_win,
      gym: gym ? 1 : 0,
      gym_type: form?.gym_type || '',
      kids_quality: kidsQuality ? 1 : 0,
      kids_quality_note: form?.kids_quality_note || '',
      bed_time_text: form?.bed_time_text || '',
      coffee: supportStack.includes('coffee') ? 1 : 0,
      adhd_meds: supportStack.includes('adhd_meds') ? 1 : 0,
      gut_bacteria_mgr: supportStack.includes('gut_bacteria_mgr') ? 1 : 0,
      gut_mvmt: supportStack.includes('gut_mvmt') ? 1 : 0,
    };

    await startReflectionForUser(chatId, reflectionContext);

    res.json({ ok: true, date, daily_score: scored.daily_score });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
