import { createHmac, timingSafeEqual } from 'crypto';
import { getTodayHST } from './scoring.js';

const SECRET =
  process.env.CHECKIN_LINK_SECRET ||
  process.env.TELEGRAM_BOT_TOKEN ||
  'dev-checkin-secret';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

function verifySignature(payloadB64, signature) {
  const expected = sign(payloadB64);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || '');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createCheckinToken({ chatId, date = getTodayHST(), ttlHours = 24 }) {
  const payload = {
    chatId: String(chatId),
    date,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
  };

  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyCheckinToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token format');
  }

  const [payloadB64, sig] = token.split('.');
  if (!verifySignature(payloadB64, sig)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (!payload?.chatId || !payload?.date || !payload?.exp) {
    throw new Error('Invalid token payload');
  }
  if (Date.now() > payload.exp) {
    throw new Error('Token expired');
  }

  return payload;
}
