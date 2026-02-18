import { Router } from 'express';
import * as db from './db.js';
import { getTodayHST, detectDrift, computeTrend } from './scoring.js';

const router = Router();

router.get('/api/today', (req, res) => {
  const log = db.getDailyLog(getTodayHST());
  res.json({ date: getTodayHST(), log: log || null });
});

router.get('/api/week', (req, res) => {
  const logs = db.getRecentLogs(7);
  const trend = computeTrend(logs);
  const drift = detectDrift(logs);
  const avg = logs.length > 0
    ? Math.round((logs.reduce((s, r) => s + r.total_score, 0) / logs.length) * 10) / 10
    : null;
  res.json({ logs, trend, drift, avg });
});

router.get('/api/history', (req, res) => {
  const logs = db.getAllLogs();
  res.json({ logs });
});

router.get('/api/reviews', (req, res) => {
  const reviews = db.getRecentReviews(8);
  res.json({ reviews });
});

export default router;
