'use strict';
// Data layer: built-in SQLite (node:sqlite), schema, password hashing and demo seed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'incentives.db');
// Demo mode fills a new database with a sample team (shared password) and example files. It is on for local
// development and off in production (NODE_ENV=production), where the first admin comes from ADMIN_* settings.
const SEED_DEMO = process.env.SEED_DEMO ? process.env.SEED_DEMO !== '0' : process.env.NODE_ENV !== 'production';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('employee','admin')),
  title         TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT '#0E7490',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS measures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  rate_cents  INTEGER NOT NULL CHECK (rate_cents >= 0),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  measure_id    INTEGER NOT NULL REFERENCES measures(id),
  file_name     TEXT NOT NULL DEFAULT '',
  file_id       INTEGER REFERENCES files(id),
  date          TEXT NOT NULL,
  patients      INTEGER NOT NULL CHECK (patients > 0),
  rate_cents    INTEGER NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_records_user_date ON records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
`;

// Deterministic PRNG so the demo data is stable between resets.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DEMO_PASSWORD = 'demo1234';

function seed(db) {
  const rand = mulberry32(20261015);
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, title, color) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const pw = hashPassword(DEMO_PASSWORD);
  const adminId = Number(
    insertUser.run('Jordan Avery', 'admin@incentive.test', pw, 'admin', 'Clinical Operations Manager', '#0F172A').lastInsertRowid
  );

  const employees = [
    ['Maya Patel', 'maya@incentive.test', 'Care Coordinator', '#0E7490'],
    ['Daniel Okafor', 'daniel@incentive.test', 'Medical Assistant', '#047857'],
    ['Sofia Ramirez', 'sofia@incentive.test', 'Registered Nurse', '#B45309'],
    ['Liam Chen', 'liam@incentive.test', 'Care Coordinator', '#4338CA'],
    ['Amara Nwosu', 'amara@incentive.test', 'Health Coach', '#BE123C'],
    ['Ethan Brooks', 'ethan@incentive.test', 'Medical Assistant', '#0369A1'],
    ['Priya Sharma', 'priya@incentive.test', 'Registered Nurse', '#7C2D12'],
    ['Noah Williams', 'noah@incentive.test', 'Patient Navigator', '#15803D'],
  ];
  const empIds = employees.map(([name, email, title, color]) =>
    Number(insertUser.run(name, email, pw, 'employee', title, color).lastInsertRowid)
  );

  const measures = [
    ['Annual Wellness Visit', 'Completed annual wellness visit with care plan documented.', 1500],
    ['Blood Pressure Control', 'BP reading captured and controlled (<140/90) in the visit.', 500],
    ['Diabetic Eye Exam', 'Retinal exam completed or result obtained for diabetic patient.', 1200],
    ['Colorectal Cancer Screening', 'Screening ordered and closed (FIT, Cologuard or colonoscopy).', 1000],
    ['Breast Cancer Screening', 'Mammogram completed or result documented.', 1000],
    ['Depression Screening (PHQ-9)', 'PHQ-9 administered with follow-up plan when positive.', 400],
    ['Medication Reconciliation', 'Post-discharge medication reconciliation within 30 days.', 750],
  ];
  const insertMeasure = db.prepare('INSERT INTO measures (name, description, rate_cents) VALUES (?, ?, ?)');
  const measureRows = measures.map(([n, d, r]) => ({ id: Number(insertMeasure.run(n, d, r).lastInsertRowid), rate: r }));

  const insertRecord = db.prepare(`INSERT INTO records
    (user_id, measure_id, file_name, date, patients, rate_cents, note, status, reviewed_by, reviewed_at, reject_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`);
  let fileSeq = 10000;

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  empIds.forEach((uid, idx) => {
    const productivity = 0.75 + rand() * 0.6 - idx * 0.03;
    for (let back = 60; back >= 1; back--) { // leave today open so the "log today" flow is visible
      const d = new Date(today);
      d.setDate(d.getDate() - back);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // weekdays only
      if (rand() < 0.12) continue; // a day off now and then
      const date = isoDate(d);
      const count = 1 + Math.floor(rand() * 3);
      const picked = new Set();
      for (let k = 0; k < count; k++) {
        const m = measureRows[Math.floor(rand() * measureRows.length)];
        if (picked.has(m.id)) continue;
        picked.add(m.id);
        const patients = Math.max(1, Math.round((2 + rand() * 9) * productivity));
        let status = 'approved';
        if (back <= 2) status = 'pending';
        else if (back <= 6 && rand() < 0.45) status = 'pending';
        else if (rand() < 0.04) status = 'rejected';
        // submitted around 5 PM local time, stored as UTC like datetime('now')
        const local = new Date(d); local.setHours(17, 10 + Math.floor(rand() * 49), 0, 0);
        const ts = local.toISOString().slice(0, 19).replace('T', ' ');
        insertRecord.run(
          uid, m.id, `PT-${++fileSeq}.pdf`, date, patients, m.rate, status,
          status === 'pending' ? null : adminId,
          status === 'pending' ? null : ts,
          status === 'rejected' ? 'Supporting documentation missing in the EHR.' : '',
          ts, ts
        );
      }
    }
  });
}

// Upgrades databases created before a column existed.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(records)').all().map((c) => c.name);
  if (!cols.includes('file_name')) {
    db.exec(`ALTER TABLE records ADD COLUMN file_name TEXT NOT NULL DEFAULT ''`);
    // give existing records a placeholder so history never shows a blank file name
    db.exec(`UPDATE records SET file_name = 'PT-' || (10000 + id) || '.pdf' WHERE file_name = ''`);
    console.log('Migrated: added records.file_name');
  }
  if (!cols.includes('file_id')) {
    db.exec('ALTER TABLE records ADD COLUMN file_id INTEGER REFERENCES files(id)');
    console.log('Migrated: added records.file_id');
  }
  // Files are managed by admins; demo databases start with a few examples.
  if (SEED_DEMO && db.prepare('SELECT COUNT(*) AS n FROM files').get().n === 0) {
    const add = db.prepare('INSERT INTO files (name, description) VALUES (?, ?)');
    for (const [n, d] of DEMO_FILES) add.run(n, d);
    console.log(`Added ${DEMO_FILES.length} example files`);
  }
}

const DEMO_FILES = [
  ['Clinic A – October 2026.xlsx', 'Primary care patient list, Clinic A'],
  ['Clinic B – October 2026.xlsx', 'Primary care patient list, Clinic B'],
  ['Home Health Batch 12.pdf', 'Home visit referrals'],
  ['Medicare Wellness List.csv', 'Patients due for an annual wellness visit'],
  ['Diabetes Registry Q4.xlsx', 'Diabetic patients needing eye exam or A1c follow-up'],
];

// Production start: the only account is the administrator named in the environment.
function createFirstAdmin(db) {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = String(process.env.ADMIN_NAME || '').trim() || 'Administrator';
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
    throw new Error('The database is empty and demo mode is off. Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD '
      + '(at least 10 characters) in .env to create the first administrator, then start again.');
  }
  db.prepare('INSERT INTO users (name, email, password_hash, role, title, color) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, email, hashPassword(password), 'admin', 'Administrator', '#111111');
  console.log(`Created the first administrator: ${email}`);
}

function open({ reset = false } = {}) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (reset && !SEED_DEMO) throw new Error('Refusing to wipe the database: --reset-db only works in demo mode.');
  if (reset && fs.existsSync(DB_FILE)) {
    for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  }
  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0 && !SEED_DEMO) createFirstAdmin(db);
  else if (n === 0) {
    db.exec('BEGIN');
    try { seed(db); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`Seeded demo data. Demo password for all accounts: ${DEMO_PASSWORD}`);
  }
  return db;
}

module.exports = { open, hashPassword, verifyPassword, isoDate, DB_FILE, SEED_DEMO };
