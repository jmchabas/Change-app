import { randomBytes } from 'crypto';
import * as db from './db.js';

const FITBIT_AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const FITBIT_API_BASE = 'https://api.fitbit.com';
const TZ = process.env.TZ || 'America/Los_Angeles';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 800;

class FitbitApiError extends Error {
  constructor(message, { status = null, retryable = false, path = '' } = {}) {
    super(message);
    this.name = 'FitbitApiError';
    this.status = status;
    this.retryable = retryable;
    this.path = path;
  }
}

function formatDateInTz(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function getDateDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatDateInTz(d);
}

function getRedirectUri(baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/auth/fitbit/callback`;
}

function getBasicAuthHeader() {
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function parseJsonSetting(key, fallback = null) {
  const raw = db.getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveTokens(tokenPayload) {
  const expiresAt = Date.now() + ((tokenPayload.expires_in || 3600) * 1000);
  const tokens = {
    access_token: tokenPayload.access_token,
    refresh_token: tokenPayload.refresh_token,
    token_type: tokenPayload.token_type,
    user_id: tokenPayload.user_id,
    scope: tokenPayload.scope,
    expires_at: expiresAt,
  };
  db.setSetting('fitbit_tokens', JSON.stringify(tokens));
  db.setSetting('fitbit_connected_at', new Date().toISOString());
}

function getStoredTokens() {
  return parseJsonSetting('fitbit_tokens');
}

async function tokenRequest(params) {
  const basicAuth = getBasicAuthHeader();
  if (!basicAuth) throw new Error('FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET missing');

  const res = await fetch(FITBIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Fitbit token request failed (${res.status}): ${text}`);
  }

  return JSON.parse(text);
}

async function getValidAccessToken() {
  const tokens = getStoredTokens();
  if (!tokens || !tokens.refresh_token) {
    throw new Error('Fitbit not connected yet');
  }

  const expiresSoon = !tokens.expires_at || (Date.now() > (tokens.expires_at - 60_000));
  if (!expiresSoon && tokens.access_token) return tokens.access_token;

  const refreshed = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  saveTokens(refreshed);
  return refreshed.access_token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function summarizeFitbitError(err) {
  if (err?.retryable || (err?.status && isRetryableStatus(err.status))) {
    return 'Fitbit is temporarily overloaded. Auto-retry is active.';
  }
  return err?.message || 'Fitbit sync failed.';
}

async function fitbitGet(path) {
  const accessToken = await getValidAccessToken();

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${FITBIT_API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      const text = await res.text();
      if (!res.ok) {
        const retryable = isRetryableStatus(res.status);
        const err = new FitbitApiError(
          `Fitbit API failed (${res.status}) ${path}: ${text}`,
          { status: res.status, retryable, path }
        );
        if (!retryable || attempt === MAX_RETRIES) throw err;

        const waitMs = BASE_BACKOFF_MS * (2 ** attempt) + Math.floor(Math.random() * 200);
        await sleep(waitMs);
        continue;
      }

      return JSON.parse(text);
    } catch (err) {
      const retryable = err instanceof FitbitApiError
        ? err.retryable
        : true; // transient network errors should retry too

      lastErr = err instanceof FitbitApiError
        ? err
        : new FitbitApiError(`Fitbit network error ${path}: ${err.message}`, {
            status: null,
            retryable,
            path,
          });

      if (!retryable || attempt === MAX_RETRIES) throw lastErr;
      const waitMs = BASE_BACKOFF_MS * (2 ** attempt) + Math.floor(Math.random() * 200);
      await sleep(waitMs);
    }
  }
  throw lastErr || new FitbitApiError(`Fitbit request failed: ${path}`, { path });
}

function parseSleepHours(sleepPayload) {
  if (sleepPayload?.summary?.totalMinutesAsleep != null) {
    return Math.round((sleepPayload.summary.totalMinutesAsleep / 60) * 10) / 10;
  }

  const mainSleep = sleepPayload?.sleep?.find((s) => s.mainSleep) || sleepPayload?.sleep?.[0];
  if (mainSleep?.minutesAsleep != null) {
    return Math.round((mainSleep.minutesAsleep / 60) * 10) / 10;
  }

  if (mainSleep?.duration != null) {
    return Math.round((mainSleep.duration / 3_600_000) * 10) / 10;
  }

  return null;
}

function parseSleepScore(sleepScorePayload, sleepPayload) {
  const v = sleepScorePayload?.sleepScore?.value
    ?? sleepScorePayload?.sleep?.[0]?.sleepScore
    ?? sleepScorePayload?.sleep_score
    ?? null;

  if (v != null && Number.isFinite(Number(v))) return Number(v);

  const fallback = sleepPayload?.sleep?.find((s) => s.mainSleep)?.efficiency
    ?? sleepPayload?.sleep?.[0]?.efficiency
    ?? null;

  return fallback != null && Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

function parseRestingHr(heartPayload) {
  const v = heartPayload?.['activities-heart']?.[0]?.value?.restingHeartRate;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

export function isFitbitConfigured() {
  return Boolean(process.env.FITBIT_CLIENT_ID && process.env.FITBIT_CLIENT_SECRET);
}

export function getFitbitStatus() {
  const tokens = getStoredTokens();
  return {
    configured: isFitbitConfigured(),
    connected: Boolean(tokens?.refresh_token),
    userId: tokens?.user_id || null,
    connectedAt: db.getSetting('fitbit_connected_at'),
    lastSyncAt: db.getSetting('fitbit_last_sync_at'),
    lastSyncError: db.getSetting('fitbit_last_sync_error'),
    lastSyncSummary: db.getSetting('fitbit_last_sync_summary'),
  };
}

export function getFitbitAuthUrl(baseUrl) {
  if (!isFitbitConfigured()) {
    throw new Error('Fitbit credentials not configured');
  }

  const state = randomBytes(24).toString('hex');
  db.setSetting('fitbit_oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.FITBIT_CLIENT_ID,
    redirect_uri: getRedirectUri(baseUrl),
    scope: 'heartrate sleep profile activity',
    expires_in: '31536000',
    prompt: 'consent',
    state,
  });

  return `${FITBIT_AUTH_URL}?${params.toString()}`;
}

export async function handleFitbitCallback({ code, state, baseUrl }) {
  const expectedState = db.getSetting('fitbit_oauth_state');
  if (!expectedState || expectedState !== state) {
    throw new Error('Invalid Fitbit OAuth state');
  }

  const tokenPayload = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(baseUrl),
    client_id: process.env.FITBIT_CLIENT_ID,
  });

  saveTokens(tokenPayload);
  db.setSetting('fitbit_oauth_state', '');
  db.setSetting('fitbit_last_sync_error', '');

  // Immediately backfill after (re)connect so dashboard is populated.
  // This helps when DB was empty after a redeploy or first-time setup.
  try {
    await syncRecentFitbitData(14);
  } catch (err) {
    db.setSetting(
      'fitbit_last_sync_error',
      `${new Date().toISOString()} ${summarizeFitbitError(err)}`
    );
  }
}

export async function syncFitbitDate(date) {
  const existing = db.getWearableMetrics(date) || {};

  let sleepPayload = null;
  let heartPayload = null;
  let sleepScorePayload = null;
  let sleepErr = null;
  let heartErr = null;

  try {
    sleepPayload = await fitbitGet(`/1.2/user/-/sleep/date/${date}.json`);
  } catch (err) {
    sleepErr = err;
  }

  try {
    heartPayload = await fitbitGet(`/1/user/-/activities/heart/date/${date}/1d.json`);
  } catch (err) {
    heartErr = err;
  }

  // Optional endpoint (availability varies by account/device).
  if (sleepPayload) {
    try {
      sleepScorePayload = await fitbitGet(`/1.2/user/-/sleep/score/date/${date}.json`);
    } catch {
      // Keep sleep sync successful even if score endpoint is unavailable.
    }
  }

  const sleepHours = sleepPayload ? parseSleepHours(sleepPayload) : existing.sleep_hours ?? null;
  const sleepScore = sleepPayload
    ? parseSleepScore(sleepScorePayload, sleepPayload)
    : existing.sleep_score ?? null;
  const restingHr = heartPayload ? parseRestingHr(heartPayload) : existing.resting_hr ?? null;

  const rawSleepJson = sleepPayload
    ? JSON.stringify(sleepPayload)
    : existing.raw_sleep_json ?? '';
  const rawHeartJson = heartPayload
    ? JSON.stringify(heartPayload)
    : existing.raw_heart_json ?? '';

  if (!sleepPayload && !heartPayload && !existing.date) {
    // No fresh data and no last-known row to preserve.
    const err = sleepErr || heartErr || new FitbitApiError('Fitbit sync failed', { retryable: true });
    throw err;
  }

  db.upsertWearableMetrics({
    date,
    source: 'fitbit',
    resting_hr: restingHr,
    sleep_hours: sleepHours,
    sleep_score: sleepScore,
    raw_sleep_json: rawSleepJson,
    raw_heart_json: rawHeartJson,
  });

  return {
    partial: Boolean((sleepErr || heartErr) && (sleepPayload || heartPayload || existing.date)),
    warnings: [sleepErr, heartErr].filter(Boolean).map((err) => summarizeFitbitError(err)),
  };
}

export async function syncRecentFitbitData(days = 3) {
  if (!isFitbitConfigured()) return { ok: false, reason: 'not-configured' };
  if (!getStoredTokens()?.refresh_token) return { ok: false, reason: 'not-connected' };

  let successCount = 0;
  const warnings = [];
  const errors = [];

  for (let i = 0; i < days; i++) {
    const date = getDateDaysAgo(i);
    try {
      const out = await syncFitbitDate(date);
      successCount++;
      if (out?.partial && out.warnings?.length) {
        warnings.push(`${date}: ${out.warnings[0]}`);
      }
    } catch (err) {
      errors.push(`${date}: ${summarizeFitbitError(err)}`);
    }
  }

  if (successCount > 0) {
    db.setSetting('fitbit_last_sync_at', new Date().toISOString());
  }

  if (errors.length > 0 || warnings.length > 0) {
    const msg = errors[0] || warnings[0] || 'Fitbit sync warning.';
    db.setSetting('fitbit_last_sync_error', `${new Date().toISOString()} ${msg}`);
  } else {
    db.setSetting('fitbit_last_sync_error', '');
  }

  const summary = `${successCount} day(s) synced · ${warnings.length} warning(s) · ${errors.length} error(s)`;
  db.setSetting('fitbit_last_sync_summary', summary);

  if (successCount === 0 && errors.length > 0) {
    throw new FitbitApiError(errors[0], { retryable: true });
  }

  return {
    ok: true,
    successCount,
    warningsCount: warnings.length,
    errorsCount: errors.length,
  };
}
