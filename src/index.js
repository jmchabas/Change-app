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

if (!TOKEN || TOKEN === 'your-telegram-bot-token-here') {
  console.error('\n✗ TELEGRAM_BOT_TOKEN not set.');
  console.error('  1. Talk to @BotFather on Telegram to create a bot');
  console.error('  2. Copy .env.example → .env and paste the token\n');
  process.exit(1);
}

// --- Initialize ---
console.log('Starting LifeOS...');

initDb();
console.log('✓ Database ready');

const bot = createBot(TOKEN);
bot.start();
console.log('✓ Telegram bot running (polling)');

startScheduler();

// --- Web dashboard ---
const app = express();
app.use(express.static(join(__dirname, '..', 'public')));
app.use(dashboardRouter);

app.listen(PORT, () => {
  console.log(`✓ Dashboard → http://localhost:${PORT}`);
  console.log('\nLifeOS is running. Send /start to your bot on Telegram.');
});
