import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initDb, closeDb } from './db.js';
import { createBot } from './bot.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import dashboardRouter from './dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TOKEN || TOKEN === 'your-telegram-bot-token-here') {
  console.error('\n✗ TELEGRAM_BOT_TOKEN not set.');
  console.error('  Talk to @BotFather on Telegram to create a bot, then add token to .env\n');
  process.exit(1);
}

if (!ANTHROPIC_KEY || ANTHROPIC_KEY === 'your-anthropic-api-key-here') {
  console.error('\n✗ ANTHROPIC_API_KEY not set.');
  console.error('  Get your key at https://console.anthropic.com and add it to .env\n');
  process.exit(1);
}

console.log('Starting LifeOS...');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

initDb();
console.log('✓ Database ready');

const bot = createBot(TOKEN);
bot.start().then(() => {
  console.log('✓ Telegram bot running (polling)');
}).catch((err) => {
  console.error('⚠ Telegram polling failed:', err?.message || err);
  console.error('⚠ App will continue running (dashboard/API still available).');
});

if (process.env.TELEGRAM_USER_ID) {
  console.log(`✓ Telegram bot locked to user ${process.env.TELEGRAM_USER_ID}`);
} else {
  console.log('⚠ TELEGRAM_USER_ID not set — any Telegram user can control the bot');
}

startScheduler();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// --- Content Security Policy ---
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
  ].join('; '));
  next();
});

// --- Dashboard authentication gate ---
const DASH_KEY = process.env.DASHBOARD_API_KEY;

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';').map(c => c.trim());
  const match = cookies.find(c => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function isAuthenticated(req) {
  if (!DASH_KEY) return true;
  return req.headers['x-api-key'] === DASH_KEY || getCookie(req, 'lifeos_key') === DASH_KEY;
}

if (DASH_KEY) {
  const PUBLIC_PATHS = [
    '/auth/login',
    '/auth/fitbit/callback',
    '/api/checkin/form',
    '/api/checkin/submit',
    '/checkin',
    '/checkin.html',
    '/favicon.svg',
  ];

  app.use((req, res, next) => {
    if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/auth/login');
  });

  console.log('✓ Dashboard authentication enabled (DASHBOARD_API_KEY set)');
} else {
  console.log('⚠ DASHBOARD_API_KEY not set — dashboard is open (OK for local dev)');
}

app.use(express.static(join(__dirname, '..', 'public')));
app.use(dashboardRouter);

const server = app.listen(PORT, () => {
  console.log(`✓ Dashboard → http://localhost:${PORT}`);
  console.log('\nLifeOS running. Send /start to your bot on Telegram.');
});

// --- Graceful shutdown ---
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down…`);
  try { bot.stop(); } catch { /* already stopped */ }
  stopScheduler();
  server.close(() => {
    closeDb();
    console.log('Shutdown complete.');
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
