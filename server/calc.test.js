'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./calc');

test('parseMoneyToCents handles common inputs exactly', () => {
  assert.equal(c.parseMoneyToCents('12'), 1200);
  assert.equal(c.parseMoneyToCents('12.5'), 1250);
  assert.equal(c.parseMoneyToCents('0.10'), 10);
  assert.equal(c.parseMoneyToCents('$1,234.56'), 123456);
  assert.equal(c.parseMoneyToCents(7.05), 705);
  assert.equal(c.parseMoneyToCents('1.234'), null);
  assert.equal(c.parseMoneyToCents('-5'), null);
  assert.equal(c.parseMoneyToCents('abc'), null);
});

test('centsToDecimal round-trips', () => {
  assert.equal(c.centsToDecimal(0), '0.00');
  assert.equal(c.centsToDecimal(705), '7.05');
  assert.equal(c.centsToDecimal(123456), '1234.56');
});

test('dates', () => {
  assert.ok(c.isIsoDate('2026-02-28'));
  assert.ok(!c.isIsoDate('2026-02-30'));
  assert.ok(!c.isIsoDate('2026-2-3'));
  assert.equal(c.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(c.daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.deepEqual(c.previousRange('2026-10-01', '2026-10-15'), { from: '2026-09-16', to: '2026-09-30' });
  assert.equal(c.fillSeries('2026-10-01', '2026-10-03', [{ date: '2026-10-02', approved: 3, pending: 1, amount_cents: 300 }]).length, 3);
});

test('rank uses competition ranking with shared ties', () => {
  const rows = [
    { id: 1, name: 'A', patients: 10, amount_cents: 100 },
    { id: 2, name: 'B', patients: 20, amount_cents: 50 },
    { id: 3, name: 'C', patients: 10, amount_cents: 300 },
    { id: 4, name: 'D', patients: 5, amount_cents: 0 },
  ];
  const r = c.rank(rows, 'patients');
  assert.deepEqual(r.map((x) => [x.id, x.rank]), [[2, 1], [3, 2], [1, 2], [4, 4]]);
  assert.deepEqual(c.rank(rows, 'amount').map((x) => x.id), [3, 1, 2, 4]);
});

test('workdayStreak skips weekends and counts today once', () => {
  // 2026-10-15 is a Thursday
  assert.equal(c.workdayStreak(['2026-10-15', '2026-10-14', '2026-10-13'], '2026-10-15'), 3);
  // today not logged yet: streak continues from yesterday
  assert.equal(c.workdayStreak(['2026-10-14', '2026-10-13'], '2026-10-15'), 2);
  // Monday streak crosses the weekend
  assert.equal(c.workdayStreak(['2026-10-12', '2026-10-09', '2026-10-08'], '2026-10-12'), 3);
  assert.equal(c.workdayStreak([], '2026-10-15'), 0);
});
