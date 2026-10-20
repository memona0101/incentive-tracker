'use strict';
// Pure calculation helpers. All money is handled as integer cents to avoid floating-point drift.

const DAY_MS = 86_400_000;

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const toDays = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
const fromDays = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const addDays = (s, n) => fromDays(toDays(s) + n);
const daysBetween = (a, b) => toDays(b) - toDays(a);
const startOfMonth = (s) => `${s.slice(0, 8)}01`;
const weekday = (s) => new Date(toDays(s) * DAY_MS).getUTCDay(); // 0 = Sunday

/** The window of equal length immediately before [from, to]. */
function previousRange(from, to) {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

/** One row per calendar day in [from, to]; missing days are zero-filled. */
function fillSeries(from, to, rows) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDate.get(d);
    out.push({ date: d, approved: r ? r.approved : 0, pending: r ? r.pending : 0, amount_cents: r ? r.amount_cents : 0 });
  }
  return out;
}

/**
 * Standard competition ranking ("1, 2, 2, 4"): equal scores share a rank.
 * Ties on the primary metric are ordered by the secondary metric, then name, for display only.
 */
function rank(rows, by = 'patients') {
  const primary = by === 'amount' ? 'amount_cents' : 'patients';
  const secondary = by === 'amount' ? 'patients' : 'amount_cents';
  const sorted = [...rows].sort((a, b) => b[primary] - a[primary] || b[secondary] - a[secondary] || a.name.localeCompare(b.name));
  let lastScore = null; let lastRank = 0;
  return sorted.map((r, i) => {
    if (r[primary] !== lastScore) { lastRank = i + 1; lastScore = r[primary]; }
    return { ...r, rank: lastRank };
  });
}

/** "12", "12.5", "12.50", "$1,234.56" -> integer cents; null when invalid. */
function parseMoneyToCents(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s$,]/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

const centsToDecimal = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;

/** Consecutive working days (Mon–Fri) with at least one record, counting back from today. Weekends never break a streak. */
function workdayStreak(dates, today) {
  const set = new Set(dates);
  const prevWorkday = (d) => { do { d = addDays(d, -1); } while ([0, 6].includes(weekday(d))); return d; };
  let cursor = today;
  if ([0, 6].includes(weekday(cursor)) || !set.has(cursor)) cursor = prevWorkday(cursor); // today isn't over yet
  let streak = 0;
  while (set.has(cursor)) { streak += 1; cursor = prevWorkday(cursor); }
  return streak;
}

module.exports = {
  isIsoDate, todayIso, addDays, daysBetween, startOfMonth, previousRange, fillSeries, rank,
  parseMoneyToCents, centsToDecimal, workdayStreak,
};
