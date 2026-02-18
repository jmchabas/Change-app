import { parseLogMessage, computeScores, detectDrift, computeTrend } from '../src/scoring.js';

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

// --- Parser tests ---

console.log('\nParser:');

test('parses a perfect day', () => {
  const r = parseLogMessage('7.5 Y Y Y Y Y Y');
  assert(r.ok, 'should be ok');
  assertEqual(r.data.sleep_hours, 7.5);
  assertEqual(r.data.bed_on_time, 1);
  assertEqual(r.data.workout, 1);
  assertEqual(r.data.eat_windows, 1);
  assertEqual(r.data.block1, 1);
  assertEqual(r.data.block2, 1);
  assertEqual(r.data.anchor, 1);
  assertEqual(r.data.total_score, 7);
});

test('parses a bad day', () => {
  const r = parseLogMessage('5.0 N N N N N N');
  assert(r.ok, 'should be ok');
  assertEqual(r.data.sleep_hours, 5.0);
  assertEqual(r.data.total_score, 0);
  assertEqual(r.data.energy_score, 0);
  assertEqual(r.data.exec_score, 0);
  assertEqual(r.data.life_score, 0);
});

test('handles lowercase y/n', () => {
  const r = parseLogMessage('8 y n y y n y');
  assert(r.ok, 'should be ok');
  assertEqual(r.data.bed_on_time, 1);
  assertEqual(r.data.workout, 0);
  assertEqual(r.data.total_score, 5);
});

test('sleep below 7.5 gets no sleep point', () => {
  const r = parseLogMessage('7.4 Y Y Y Y Y Y');
  assert(r.ok);
  assertEqual(r.data.energy_score, 3, 'energy_score');
  assertEqual(r.data.total_score, 6, 'total_score');
});

test('sleep at exactly 7.5 gets sleep point', () => {
  const r = parseLogMessage('7.5 Y Y Y Y Y Y');
  assert(r.ok);
  assertEqual(r.data.energy_score, 4, 'energy_score');
  assertEqual(r.data.total_score, 7, 'total_score');
});

test('extra text becomes notes', () => {
  const r = parseLogMessage('7 Y Y Y Y Y Y great day today');
  assert(r.ok);
  assertEqual(r.data.notes, 'great day today');
});

test('rejects too few values', () => {
  const r = parseLogMessage('7.5 Y Y');
  assert(!r.ok, 'should fail');
  assert(r.error.includes('Expected 7'), 'should mention expected count');
});

test('rejects invalid sleep value', () => {
  const r = parseLogMessage('abc Y Y Y Y Y Y');
  assert(!r.ok);
  assert(r.error.includes('Sleep hours'), 'should mention sleep');
});

test('rejects sleep > 14', () => {
  const r = parseLogMessage('15 Y Y Y Y Y Y');
  assert(!r.ok);
});

test('rejects invalid Y/N value', () => {
  const r = parseLogMessage('7 Y X Y Y Y Y');
  assert(!r.ok);
  assert(r.error.includes('Y or N'), 'should mention Y or N');
});

test('handles extra whitespace', () => {
  const r = parseLogMessage('  7.5  Y  Y  Y  Y  Y  Y  ');
  assert(r.ok);
  assertEqual(r.data.total_score, 7);
});

// --- Score computation tests ---

console.log('\nScoring:');

test('perfect scores', () => {
  const s = computeScores(8, [1, 1, 1, 1, 1, 1]);
  assertEqual(s.energy_score, 4);
  assertEqual(s.exec_score, 2);
  assertEqual(s.life_score, 1);
  assertEqual(s.total_score, 7);
});

test('zero scores', () => {
  const s = computeScores(5, [0, 0, 0, 0, 0, 0]);
  assertEqual(s.total_score, 0);
});

// --- Drift detection tests ---

console.log('\nDrift:');

test('no drift on perfect week', () => {
  const logs = Array(7).fill({
    sleep_hours: 8, bed_on_time: 1, eat_windows: 1,
    block1: 1, block2: 1, anchor: 1, total_score: 7,
  });
  const d = detectDrift(logs);
  assertEqual(d.biggest, 'None');
});

test('detects sleep drift', () => {
  const logs = Array(7).fill({
    sleep_hours: 6, bed_on_time: 0, eat_windows: 1,
    block1: 1, block2: 1, anchor: 1, total_score: 5,
  });
  const d = detectDrift(logs);
  assert(d.drifts.some(x => x.area === 'SLEEP'), 'should detect SLEEP drift');
});

test('detects food drift', () => {
  const logs = Array(7).fill({
    sleep_hours: 8, bed_on_time: 1, eat_windows: 0,
    block1: 1, block2: 1, anchor: 1, total_score: 5,
  });
  const d = detectDrift(logs);
  assert(d.drifts.some(x => x.area === 'FOOD'), 'should detect FOOD drift');
});

test('detects work drift', () => {
  const logs = Array(7).fill({
    sleep_hours: 8, bed_on_time: 1, eat_windows: 1,
    block1: 0, block2: 0, anchor: 1, total_score: 4,
  });
  const d = detectDrift(logs);
  assert(d.drifts.some(x => x.area === 'WORK'), 'should detect WORK drift');
});

// --- Trend tests ---

console.log('\nTrend:');

test('flat trend with same scores', () => {
  const logs = Array(7).fill({ total_score: 5 });
  assertEqual(computeTrend(logs), '→ FLAT');
});

test('up trend when recent scores higher', () => {
  const logs = [
    { total_score: 7 }, { total_score: 7 }, { total_score: 6 },
    { total_score: 3 }, { total_score: 3 }, { total_score: 3 }, { total_score: 3 },
  ];
  assertEqual(computeTrend(logs), '↑ UP');
});

test('down trend when recent scores lower', () => {
  const logs = [
    { total_score: 2 }, { total_score: 2 }, { total_score: 2 },
    { total_score: 6 }, { total_score: 6 }, { total_score: 6 }, { total_score: 6 },
  ];
  assertEqual(computeTrend(logs), '↓ DOWN');
});

// --- Summary ---

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
