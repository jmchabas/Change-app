import { computeDetailedScores } from '../src/scoring.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Expected'} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertApprox(actual, expected, epsilon = 0.001, msg) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${msg || 'Expected approx'} ${expected}, got ${actual}`);
  }
}

console.log('\nWeekend scoring:');

test('0) friday is a weekday', () => {
  const s = computeDetailedScores({
    date: '2026-03-06', // Friday
    escape_media_minutes: 0,
    outside_window_meals: 0,
    clean_evening: true,
    work_win: null,
    personal_win: null,
    gym: true,
    kids_quality: true,
    bed_time_text: '',
    mood_1_10: 8,
  });
  assertEqual(s.is_weekend, false, 'Friday should be a weekday');
  assertEqual(s.active_possible_points, 80, 'Friday denominator should be behavior-only 80');
});

test('1) weekend, no optional filled → perfect on required', () => {
  const s = computeDetailedScores({
    date: '2026-03-07', // Saturday
    escape_media_minutes: 0,
    outside_window_meals: 0,
    clean_evening: true,
    work_win: null,
    personal_win: null,
    gym: true,
    kids_quality: true,
    bed_time_text: '',
    mood_1_10: 8,
  });
  assertEqual(s.is_weekend, true, 'should detect weekend');
  assertEqual(s.active_possible_points, 50, 'denominator = 5 required habits × 10');
  assertApprox(s.daily_score, 100, 0.05, 'perfect on all required = 100');
});

test('2) weekend, "No" on optional excludes it (same as blank)', () => {
  const s = computeDetailedScores({
    date: '2026-03-08', // Sunday
    escape_media_minutes: 0,
    outside_window_meals: 0,
    clean_evening: true,
    work_win: false, // "No" → excluded on weekend
    personal_win: null,
    gym: true,
    kids_quality: true,
    bed_time_text: '',
    mood_1_10: 8,
  });
  assertEqual(s.active_possible_points, 50, '"No" on weekend optional should not increase denominator');
  assertApprox(s.daily_score, 100, 0.05, 'same score as all-blank optionals');
});

test('3) weekend, invalid optional input (excluded)', () => {
  const s = computeDetailedScores({
    date: '2026-03-07',
    escape_media_minutes: 0,
    outside_window_meals: 0,
    clean_evening: true,
    work_win: 'not-valid',
    personal_win: null,
    gym: true,
    kids_quality: true,
    bed_time_text: 'not-a-time',
    mood_1_10: 8,
  });
  assertEqual(s.active_possible_points, 50, 'invalid optional inputs should not change denominator');
  assertApprox(s.daily_score, 100, 0.05, 'invalid optional inputs should not change score');
});

test('4) weekend, all optional "Yes" fills denominator', () => {
  const s = computeDetailedScores({
    date: '2026-03-08',
    escape_media_minutes: 0,
    outside_window_meals: 0,
    clean_evening: true,
    work_win: true,
    personal_win: true,
    gym: true,
    kids_quality: true,
    bed_time_text: '9:25pm',
    mood_1_10: 8,
  });
  assertEqual(s.active_possible_points, 80, 'all Yes optionals should give behavior max 80');
  assertApprox(s.daily_score, 100, 0.05, 'weekend score with all optional Yes and all passed');
});

console.log('\nWeekday scoring:');

test('5) weekday — execution only, mood excluded', () => {
  const s = computeDetailedScores({
    date: '2026-03-04', // Wednesday
    escape_media_minutes: 15,  // 8
    outside_window_meals: 1,   // 6
    clean_evening: true,       // 10
    work_win: false,           // 0
    personal_win: true,        // 10
    gym: true,                 // 10
    kids_quality: false,       // 0
    bed_time_text: '10:00pm',  // 8
    mood_1_10: 7,              // tracked separately
  });
  // behavior = 8+6+10+0+10+10+0+8 = 52
  assertEqual(s.is_weekend, false, 'should detect weekday');
  assertEqual(s.active_possible_points, 80, 'weekday denominator is behavior-only 80');
  assertEqual(s.daily_score, 65, 'weekday execution score = (52/80)*100');
  assertEqual(s.state_score, 14, 'state score still tracked');
  assertEqual(s.mood_1_10, 7, 'mood still stored');
});

// --- Summary ---

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
