import { Router } from 'express';
import * as db from './db.js';
import { getTodayHST, computeTrend } from './scoring.js';

const router = Router();

router.get('/api/today', (req, res) => {
  const today = getTodayHST();
  const log = db.getDailyLog(today);
  const targets = db.getDeliverables(today);
  res.json({ date: today, log: log || null, targets: targets || null });
});

router.get('/api/week', (req, res) => {
  const logs = db.getRecentLogs(7);
  const trend = computeTrend(logs);
  const avg = logs.length > 0
    ? Math.round((logs.reduce((s, r) => s + (r.total_score || 0), 0) / logs.length) * 10) / 10
    : null;
  const avgMood = logs.filter(l => l.mood).length > 0
    ? Math.round((logs.reduce((s, l) => s + (l.mood || 0), 0) / logs.filter(l => l.mood).length) * 10) / 10
    : null;
  res.json({ logs, trend, avg, avgMood });
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

export default router;
