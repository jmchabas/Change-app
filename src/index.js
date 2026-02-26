import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';
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
  // Keep process alive for dashboard/API even if background integrations fail.
  console.error('Unhandled rejection:', reason);
});

initDb();
console.log('✓ Database ready');

const bot = createBot(TOKEN);
bot.start().then(() => {
  console.log('✓ Telegram bot running (polling)');
}).catch((err) => {
  // Common case: 409 when another process polls same Telegram token.
  console.error('⚠ Telegram polling failed:', err?.message || err);
  console.error('⚠ App will continue running (dashboard/API still available).');
});

startScheduler();

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));
app.use(dashboardRouter);

app.listen(PORT, () => {
  console.log(`✓ Dashboard → http://localhost:${PORT}`);
  console.log('\nLifeOS running. Send /start to your bot on Telegram.');
});
