'use strict';
// Incentive Tracker — zero-dependency HTTP server (Node >= 22.13).
// JSON API + Server-Sent Events for live updates + static SPA hosting.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const dbm = require('./db');
const calc = require('./calc');

const args = new Set(process.argv.slice(2));
const db = (() => {
  try { return dbm.open({ reset: args.has('--reset-db') }); }
  catch (err) { console.error(`\nCan't start: ${err.message}\n`); process.exit(1); } // e.g. production without ADMIN_* settings
})();
if (args.has('--exit')) { console.log('Database ready:', dbm.DB_FILE); process.exit(0); }

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_COOKIE = 'it_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const BACKDATE_LIMIT_DAYS = 3;
const MAX_PATIENTS = 99999; // per entry; a sanity cap against typos, large files can cover thousands of patients

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const bad = (msg, details) => new HttpError(400, msg, details);

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!type.startsWith('application/json')) return reject(new HttpError(415, 'Expected application/json'));
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(bad('Malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intParam = (v, def) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : def; };

function publicUser(u) {
  return u && { id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, color: u.color, active: !!u.active };
}

// ---------------------------------------------------------------- auth
function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
  ).get(token, Date.now());
  return row || null;
}

const loginFailures = new Map(); // key -> { count, until }
function checkLoginThrottle(key) {
  const f = loginFailures.get(key);
  if (f && f.count >= 8 && f.until > Date.now()) {
    throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
}
function noteLoginFailure(key) {
  const f = loginFailures.get(key) || { count: 0, until: 0 };
  f.count += 1; f.until = Date.now() + 10 * 60 * 1000;
  loginFailures.set(key, f);
}

// ---------------------------------------------------------------- live events (SSE)
const clients = new Set();
function broadcast(type, data = {}) {
  const msg = `event: change\ndata: ${JSON.stringify({ type, at: Date.now(), ...data })}\n\n`;
  for (const c of clients) {
    try { c.res.write(msg); } catch { clients.delete(c); }
  }
}
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch { clients.delete(c); } } }, 25_000).unref();

// ---------------------------------------------------------------- domain queries
const RECORD_SELECT = `
  SELECT r.id, r.user_id, r.measure_id, r.file_name, r.date, r.patients, r.rate_cents, r.note, r.status,
         r.reviewed_at, r.reject_reason, r.created_at, r.updated_at,
         (r.patients * r.rate_cents) AS amount_cents,
         m.name AS measure_name, u.name AS user_name, u.color AS user_color, u.title AS user_title,
         rv.name AS reviewer_name
  FROM records r
  JOIN measures m ON m.id = r.measure_id
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users rv ON rv.id = r.reviewed_by`;

function buildRecordFilter(q, user) {
  const where = []; const params = [];
  if (user.role !== 'admin') { where.push('r.user_id = ?'); params.push(user.id); }
  else if (q.get('user')) { where.push('r.user_id = ?'); params.push(intParam(q.get('user'), 0)); }
  const status = q.get('status');
  if (status && ['pending', 'approved', 'rejected'].includes(status)) { where.push('r.status = ?'); params.push(status); }
  if (q.get('measure')) { where.push('r.measure_id = ?'); params.push(intParam(q.get('measure'), 0)); }
  const from = q.get('from'); const to = q.get('to');
  if (from && calc.isIsoDate(from)) { where.push('r.date >= ?'); params.push(from); }
  if (to && calc.isIsoDate(to)) { where.push('r.date <= ?'); params.push(to); }
  const term = str(q.get('q'), 80);
  if (term) {
    where.push('(r.file_name LIKE ? OR m.name LIKE ? OR u.name LIKE ? OR r.note LIKE ?)');
    const like = `%${term.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

function listRecords(q, user) {
  const { sql, params } = buildRecordFilter(q, user);
  const limit = Math.min(Math.max(intParam(q.get('limit'), 25), 1), 200);
  const page = Math.max(intParam(q.get('page'), 1), 1);
  const sort = q.get('sort');
  // 'recent' = latest activity first (a review counts as activity), used by the admin activity feed
  const order = sort === 'oldest' ? 'r.date ASC, r.id ASC'
    : sort === 'recent' ? 'COALESCE(r.reviewed_at, r.created_at) DESC, r.id DESC' : 'r.date DESC, r.id DESC';
  const agg = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(r.patients),0) AS patients, COALESCE(SUM(r.patients*r.rate_cents),0) AS amount_cents
     FROM records r JOIN measures m ON m.id = r.measure_id JOIN users u ON u.id = r.user_id ${sql}`
  ).get(...params);
  const items = db.prepare(`${RECORD_SELECT}${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return { items, total: agg.total, page, limit, totals: { patients: agg.patients, amount_cents: agg.amount_cents } };
}

function getRecord(id) {
  return db.prepare(`${RECORD_SELECT} WHERE r.id = ?`).get(id);
}

function validateEntryDate(date) {
  if (!calc.isIsoDate(date)) throw bad('Please choose a valid date.', { field: 'date' });
  const today = calc.todayIso();
  // allow one day of slack for users ahead of the server's time zone
  if (date > calc.addDays(today, 1)) throw bad('Records cannot be logged for a future date.', { field: 'date' });
  if (date < calc.addDays(today, -BACKDATE_LIMIT_DAYS)) {
    throw bad(`Records can only be logged for today or the previous ${BACKDATE_LIMIT_DAYS} days. Ask an administrator if you missed an earlier date.`, { field: 'date' });
  }
}

function validatePatients(n, field = 'patients') {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PATIENTS) {
    throw bad(`Number of patients must be a whole number between 1 and ${MAX_PATIENTS}.`, { field });
  }
}

function activeMeasure(id) {
  const m = db.prepare('SELECT * FROM measures WHERE id = ?').get(id);
  if (!m || !m.active) throw bad('That measure is not available. Please pick another one.', { field: 'measure' });
  return m;
}

/** Typed measure name -> existing active measure, or { id: 0, name } to be created on insert. */
function resolveMeasureName(v, field) {
  const name = str(v, 200).replace(/\s+/g, ' ');
  if (!name) throw bad('Enter the measure name or number.', { field });
  if (name.length > 80) throw bad('Measure must be 80 characters or fewer.', { field });
  const m = db.prepare('SELECT * FROM measures WHERE name = ? COLLATE NOCASE').get(name);
  if (m && !m.active) throw bad(`"${m.name}" has been retired by an administrator. Choose another measure.`, { field });
  return m || { id: 0, name, rate_cents: 0 };
}

// One record per employee + date + measure + file name (rejected records free the slot).
function duplicateFor(userId, measureId, date, fileName, exceptId = 0) {
  return db.prepare(
    `SELECT id FROM records WHERE user_id = ? AND measure_id = ? AND date = ? AND file_name = ? COLLATE NOCASE AND status != 'rejected' AND id != ?`
  ).get(userId, measureId, date, fileName, exceptId);
}


function range(q) {
  const today = calc.todayIso();
  let from = q.get('from'); let to = q.get('to');
  if (!calc.isIsoDate(to)) to = today;
  if (!calc.isIsoDate(from)) from = calc.startOfMonth(to);
  if (from > to) [from, to] = [to, from];
  if (calc.daysBetween(from, to) > 400) from = calc.addDays(to, -400);
  // comparison window: client may send a like-for-like range (e.g. same days last month)
  let prevFrom = q.get('prevFrom'); let prevTo = q.get('prevTo');
  if (!calc.isIsoDate(prevFrom) || !calc.isIsoDate(prevTo) || prevFrom > prevTo || prevTo >= from) {
    ({ from: prevFrom, to: prevTo } = calc.previousRange(from, to));
  }
  return { from, to, prev: { from: prevFrom, to: prevTo } };
}

function employeeTotals(from, to) {
  return db.prepare(`
    SELECT u.id, u.name, u.title, u.color,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN r.patients END),0) AS patients,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN r.patients*r.rate_cents END),0) AS amount_cents,
      COALESCE(SUM(CASE WHEN r.status='pending' THEN r.patients END),0) AS pending_patients,
      COUNT(CASE WHEN r.status='approved' THEN 1 END) AS records,
      COUNT(DISTINCT CASE WHEN r.status='approved' THEN r.date END) AS active_days
    FROM users u
    LEFT JOIN records r ON r.user_id = u.id AND r.date BETWEEN ? AND ?
    WHERE u.role = 'employee' AND u.active = 1
    GROUP BY u.id`).all(from, to);
}

function leaderboard(from, to, by, prev = calc.previousRange(from, to)) {
  const rows = calc.rank(employeeTotals(from, to), by);
  const prevRanks = new Map(calc.rank(employeeTotals(prev.from, prev.to), by).map((r) => [r.id, r.rank]));
  for (const r of rows) {
    const p = prevRanks.get(r.id);
    r.movement = p ? p - r.rank : 0;
  }
  const totals = rows.reduce((a, r) => ({
    patients: a.patients + r.patients, amount_cents: a.amount_cents + r.amount_cents,
    pending_patients: a.pending_patients + r.pending_patients,
  }), { patients: 0, amount_cents: 0, pending_patients: 0 });
  return { from, to, by, employees: rows.length, totals, rows };
}

// Hall of Fame: the top employee (most approved patients) of each of the last `months` completed calendar months.
// Deactivated employees still count here: it is a record of past months. Ties go to the earlier name alphabetically.
function hallOfFame(months = 6) {
  const [y, m] = calc.todayIso().split('-').map(Number);
  const monthStart = (back) => { const d = new Date(Date.UTC(y, m - 1 - back, 1)); return d.toISOString().slice(0, 10); };
  const from = monthStart(months); const to = monthStart(0); // [from, to)
  const rows = db.prepare(`
    SELECT substr(r.date, 1, 7) AS month, u.id, u.name, u.title, u.color, SUM(r.patients) AS patients
    FROM records r JOIN users u ON u.id = r.user_id
    WHERE r.status = 'approved' AND u.role = 'employee' AND r.date >= ? AND r.date < ?
    GROUP BY month, u.id
    ORDER BY month DESC, patients DESC, u.name COLLATE NOCASE`).all(from, to);
  const best = new Map();
  for (const r of rows) if (!best.has(r.month) && r.patients > 0) best.set(r.month, r);
  return [...best.values()];
}

function periodSummary(userId, from, to) {
  const where = userId ? 'r.user_id = ? AND ' : '';
  const params = userId ? [userId, from, to] : [from, to];
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status='approved' THEN patients END),0) AS approved_patients,
      COALESCE(SUM(CASE WHEN status='approved' THEN patients*rate_cents END),0) AS approved_cents,
      COALESCE(SUM(CASE WHEN status='pending' THEN patients END),0) AS pending_patients,
      COALESCE(SUM(CASE WHEN status='pending' THEN patients*rate_cents END),0) AS pending_cents,
      COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN status='approved' THEN 1 END) AS approved_count,
      COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected_count,
      COUNT(DISTINCT CASE WHEN status!='rejected' THEN date END) AS active_days
    FROM records r WHERE ${where} r.date BETWEEN ? AND ?`).get(...params);
}

function dailySeries(userId, from, to) {
  const where = userId ? 'user_id = ? AND ' : '';
  const params = userId ? [userId, from, to] : [from, to];
  const rows = db.prepare(`
    SELECT date,
      COALESCE(SUM(CASE WHEN status='approved' THEN patients END),0) AS approved,
      COALESCE(SUM(CASE WHEN status='pending' THEN patients END),0) AS pending,
      COALESCE(SUM(CASE WHEN status='approved' THEN patients*rate_cents END),0) AS amount_cents
    FROM records WHERE ${where} date BETWEEN ? AND ? GROUP BY date`).all(...params);
  return calc.fillSeries(from, to, rows);
}

function measureBreakdown(userId, from, to) {
  const where = userId ? 'r.user_id = ? AND ' : '';
  const params = userId ? [userId, from, to] : [from, to];
  return db.prepare(`
    SELECT m.id, m.name,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN r.patients END),0) AS approved,
      COALESCE(SUM(CASE WHEN r.status='pending' THEN r.patients END),0) AS pending,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN r.patients*r.rate_cents END),0) AS amount_cents
    FROM records r JOIN measures m ON m.id = r.measure_id
    WHERE ${where} r.date BETWEEN ? AND ? AND r.status != 'rejected'
    GROUP BY m.id ORDER BY (approved + pending) DESC`).all(...params);
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, opts, handler) => routes.push({ method, pattern, opts, handler });

// Mark the session cookie Secure when the site is served over HTTPS: COOKIE_SECURE=1, or the reverse proxy
// (Caddy on the office server) reports the original request was https.
function secureFlag(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return process.env.COOKIE_SECURE === '1' || proto === 'https' ? '; Secure' : '';
}

// Behind Caddy every connection comes from the proxy. TRUST_PROXY=1 uses the client address it appends to
// X-Forwarded-For instead (the last entry: earlier ones could be sent by the browser itself).
function clientIp(req) {
  const fwd = process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return fwd || req.socket.remoteAddress;
}

route('POST', /^\/api\/auth\/login$/, { auth: false }, async (req, res) => {
  const body = await readJson(req);
  const email = str(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const key = `${clientIp(req)}|${email}`;
  checkLoginThrottle(key);
  if (!email || !password) throw bad('Enter your email and password.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !dbm.verifyPassword(password, user.password_hash)) {
    noteLoginFailure(key);
    throw new HttpError(401, 'That email and password combination is not recognised.');
  }
  if (!user.active) throw new HttpError(403, 'This account has been deactivated. Contact your administrator.');
  loginFailures.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Date.now() + SESSION_TTL_MS);
  send(res, 200, { user: publicUser(user) }, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag(req)}`,
  });
});

route('POST', /^\/api\/auth\/logout$/, { auth: false }, async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  send(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag(req)}` });
});

route('GET', /^\/api\/me$/, {}, async (req, res, { user }) => send(res, 200, { user: publicUser(user) }));

// Anyone signed in can change their own password; it signs out their other devices, not this one.
route('POST', /^\/api\/me\/password$/, {}, async (req, res, { user }) => {
  const body = await readJson(req);
  const key = `password|${user.id}`;
  checkLoginThrottle(key);
  const current = typeof body.current === 'string' ? body.current : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!dbm.verifyPassword(current, user.password_hash)) {
    noteLoginFailure(key);
    throw bad('Your current password is not correct.', { field: 'current' });
  }
  loginFailures.delete(key);
  if (password.length < 8) throw bad('Use at least 8 characters.', { field: 'password' });
  if (password === current) throw bad('Choose a password different from your current one.', { field: 'password' });
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(dbm.hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(user.id, token);
  send(res, 200, { ok: true });
});

route('GET', /^\/api\/config$/, { auth: false }, async (req, res) => send(res, 200, {
  currency: process.env.CURRENCY || 'USD', backdateLimitDays: BACKDATE_LIMIT_DAYS, maxPatients: MAX_PATIENTS,
  demo: process.env.DEMO ? process.env.DEMO !== '0' : dbm.SEED_DEMO, // demo sign-in shortcuts
}));

route('GET', /^\/api\/events$/, {}, async (req, res, { user }) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ userId: user.id, online: clients.size + 1 })}\n\n`);
  const client = { res, userId: user.id };
  clients.add(client);
  req.on('close', () => clients.delete(client));
});

// measures
route('GET', /^\/api\/measures$/, {}, async (req, res, { user, url }) => {
  const all = user.role === 'admin' && url.searchParams.get('all') === '1';
  const rows = db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM records r WHERE r.measure_id = m.id) AS usage
    FROM measures m ${all ? '' : 'WHERE m.active = 1'} ORDER BY m.active DESC, m.name`).all();
  send(res, 200, { items: rows.map((m) => ({ ...m, active: !!m.active })) });
});

route('POST', /^\/api\/measures$/, { admin: true }, async (req, res) => {
  const body = await readJson(req);
  const name = str(body.name, 80);
  if (name.length < 2) throw bad('Measure name must be at least 2 characters.', { field: 'name' });
  // Rates are optional (the UI no longer shows money); default to 0.
  const cents = body.rate === undefined || body.rate === '' ? 0 : calc.parseMoneyToCents(body.rate);
  if (cents === null) throw bad('Enter a valid rate, e.g. 12.50', { field: 'rate' });
  if (db.prepare('SELECT 1 FROM measures WHERE name = ?').get(name)) throw new HttpError(409, 'A measure with that name already exists.', { field: 'name' });
  const id = Number(db.prepare('INSERT INTO measures (name, description, rate_cents) VALUES (?, ?, ?)')
    .run(name, str(body.description, 300), cents).lastInsertRowid);
  broadcast('measure.changed', { measureId: id });
  send(res, 201, { item: db.prepare('SELECT * FROM measures WHERE id = ?').get(id) });
});

route('PATCH', /^\/api\/measures\/(\d+)$/, { admin: true }, async (req, res, { params }) => {
  const id = Number(params[0]);
  const m = db.prepare('SELECT * FROM measures WHERE id = ?').get(id);
  if (!m) throw new HttpError(404, 'Measure not found.');
  const body = await readJson(req);
  const next = { name: m.name, description: m.description, rate_cents: m.rate_cents, active: m.active };
  if (body.name !== undefined) {
    next.name = str(body.name, 80);
    if (next.name.length < 2) throw bad('Measure name must be at least 2 characters.', { field: 'name' });
    if (db.prepare('SELECT 1 FROM measures WHERE name = ? AND id != ?').get(next.name, id)) throw new HttpError(409, 'A measure with that name already exists.', { field: 'name' });
  }
  if (body.description !== undefined) next.description = str(body.description, 300);
  if (body.rate !== undefined) {
    const cents = calc.parseMoneyToCents(body.rate);
    if (cents === null) throw bad('Enter a valid rate, e.g. 12.50', { field: 'rate' });
    next.rate_cents = cents;
  }
  if (body.active !== undefined) next.active = body.active ? 1 : 0;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE measures SET name=?, description=?, rate_cents=?, active=? WHERE id=?')
      .run(next.name, next.description, next.rate_cents, next.active, id);
    // New rates apply to records still awaiting review; approved payouts are locked.
    if (next.rate_cents !== m.rate_cents) {
      db.prepare(`UPDATE records SET rate_cents=?, updated_at=datetime('now') WHERE measure_id=? AND status='pending'`).run(next.rate_cents, id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  broadcast('measure.changed', { measureId: id });
  send(res, 200, { item: db.prepare('SELECT * FROM measures WHERE id = ?').get(id) });
});

// files (managed by admins; employees pick one per entry)
function fileRow(id) {
  const f = db.prepare('SELECT f.*, (SELECT COUNT(*) FROM records r WHERE r.file_id = f.id) AS usage FROM files f WHERE f.id = ?').get(id);
  return f && { ...f, active: !!f.active };
}

function validateFileFields(body, current) {
  const next = { name: current?.name ?? '', description: current?.description ?? '' };
  if (body.name !== undefined || !current) {
    next.name = str(body.name, 500).replace(/\s+/g, ' ');
    if (next.name.length < 2) throw bad('File name must be at least 2 characters.', { field: 'name' });
    if (next.name.length > 120) throw bad('File name must be 120 characters or fewer.', { field: 'name' });
    if (/[\x00-\x1f]/.test(next.name)) throw bad('File name contains invalid characters.', { field: 'name' });
    if (db.prepare('SELECT 1 FROM files WHERE name = ? AND id != ?').get(next.name, current?.id ?? 0)) {
      throw new HttpError(409, 'A file with that name already exists.', { field: 'name' });
    }
  }
  if (body.description !== undefined) next.description = str(body.description, 300);
  return next;
}

route('GET', /^\/api\/files$/, {}, async (req, res, { user, url }) => {
  const all = user.role === 'admin' && url.searchParams.get('all') === '1';
  const rows = db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM records r WHERE r.file_id = f.id) AS usage
    FROM files f ${all ? '' : 'WHERE f.active = 1'} ORDER BY f.active DESC, f.created_at DESC, f.name`).all();
  send(res, 200, { items: rows.map((f) => ({ ...f, active: !!f.active })) });
});

route('POST', /^\/api\/files$/, { admin: true }, async (req, res) => {
  const body = await readJson(req);
  const f = validateFileFields(body, null);
  const id = Number(db.prepare('INSERT INTO files (name, description) VALUES (?, ?)').run(f.name, f.description).lastInsertRowid);
  broadcast('file.changed', { fileId: id });
  send(res, 201, { item: fileRow(id) });
});

route('PATCH', /^\/api\/files\/(\d+)$/, { admin: true }, async (req, res, { params }) => {
  const id = Number(params[0]);
  const cur = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!cur) throw new HttpError(404, 'File not found.');
  const body = await readJson(req);
  const f = validateFileFields(body, cur);
  const active = body.active !== undefined ? (body.active ? 1 : 0) : cur.active;
  db.prepare('UPDATE files SET name = ?, description = ?, active = ? WHERE id = ?').run(f.name, f.description, active, id);
  broadcast('file.changed', { fileId: id });
  send(res, 200, { item: fileRow(id) });
});

function activeFile(id, field) {
  const f = Number.isInteger(id) && id > 0 ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : null;
  if (!f) throw bad('Choose a file from the list.', { field });
  if (!f.active) throw bad(`"${f.name}" is no longer available. Choose another file.`, { field });
  return f;
}

// records
route('GET', /^\/api\/records$/, {}, async (req, res, { user, url }) => send(res, 200, listRecords(url.searchParams, user)));

route('GET', /^\/api\/records\.csv$/, {}, async (req, res, { user, url }) => {
  url.searchParams.set('limit', '200');
  const rows = [];
  for (let page = 1; ; page++) {
    url.searchParams.set('page', String(page));
    const chunk = listRecords(url.searchParams, user);
    rows.push(...chunk.items);
    if (rows.length >= chunk.total || !chunk.items.length || page >= 100) break;
  }
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Date', 'Employee', 'File name', 'Measure', 'Patients', 'Status', 'Reviewed by', 'Reviewed at', 'Note', 'Reject reason'].join(',')];
  for (const r of rows) {
    lines.push([r.date, r.user_name, r.file_name, r.measure_name, r.patients,
      r.status, r.reviewer_name || '', r.reviewed_at || '', r.note, r.reject_reason].map(esc).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="incentive-records-${calc.todayIso()}.csv"`,
  });
  res.end('﻿' + lines.join('\r\n'));
});

route('POST', /^\/api\/records$/, {}, async (req, res, { user }) => {
  if (user.role !== 'employee') throw new HttpError(403, 'Only employees can log records.');
  const body = await readJson(req);
  const date = str(body.date, 10);
  validateEntryDate(date);
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length) throw bad('Add at least one measure.');
  if (entries.length > 20) throw bad('You can submit up to 20 files at a time.');
  const seen = new Set();
  const prepared = entries.map((e, i) => {
    const file = activeFile(Number(e.fileId), `entries.${i}.file`);
    const fileName = file.name;
    // Measure: an existing id, or a typed name (matched case-insensitively, created if new)
    const measure = e.measureName !== undefined ? resolveMeasureName(e.measureName, `entries.${i}.measure`) : activeMeasure(Number(e.measureId));
    const patients = Number(e.patients);
    validatePatients(patients, `entries.${i}.patients`);
    const key = `${measure.name.toLowerCase()}|${fileName.toLowerCase()}`;
    if (seen.has(key)) throw bad(`"${fileName}" with "${measure.name}" is listed twice. Combine them into one entry.`, { field: `entries.${i}.file` });
    seen.add(key);
    if (measure.id && duplicateFor(user.id, measure.id, date, fileName)) {
      throw new HttpError(409, `You already logged "${fileName}" for "${measure.name}" on ${date}. Delete that record from your history if you need to log it again.`, { field: `entries.${i}.file` });
    }
    return { file, fileName, measure, patients, note: str(e.note, 300) };
  });
  const ids = [];
  let createdMeasures = 0;
  db.exec('BEGIN');
  try {
    const created = new Map(); // lower-case name -> new measure row, so a name typed twice is created once
    const addMeasure = db.prepare('INSERT INTO measures (name, description, rate_cents) VALUES (?, ?, 0)');
    const ins = db.prepare('INSERT INTO records (user_id, measure_id, file_id, file_name, date, patients, rate_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const p of prepared) {
      let m = p.measure;
      if (!m.id) {
        m = created.get(m.name.toLowerCase());
        if (!m) {
          const id = Number(addMeasure.run(p.measure.name, `Added by ${user.name}`).lastInsertRowid);
          m = { id, name: p.measure.name, rate_cents: 0 };
          created.set(m.name.toLowerCase(), m); createdMeasures += 1;
        }
      }
      ids.push(Number(ins.run(user.id, m.id, p.file.id, p.fileName, date, p.patients, m.rate_cents, p.note).lastInsertRowid));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (createdMeasures) broadcast('measure.changed', {});
  const items = ids.map(getRecord);
  broadcast('record.created', { ownerId: user.id, ownerName: user.name, count: items.length });
  send(res, 201, { items });
});

route('PATCH', /^\/api\/records\/(\d+)$/, {}, async (req, res, { user, params }) => {
  const rec = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(params[0]));
  if (!rec || rec.user_id !== user.id) throw new HttpError(404, 'Record not found.');
  if (rec.status !== 'pending') throw new HttpError(409, 'Only records awaiting approval can be edited.');
  const body = await readJson(req);
  const date = body.date !== undefined ? str(body.date, 10) : rec.date;
  if (date !== rec.date) validateEntryDate(date);
  const measure = body.measureId !== undefined ? activeMeasure(Number(body.measureId)) : db.prepare('SELECT * FROM measures WHERE id = ?').get(rec.measure_id);
  const patients = body.patients !== undefined ? Number(body.patients) : rec.patients;
  validatePatients(patients);
  if (duplicateFor(user.id, measure.id, date, rec.file_name, rec.id)) throw new HttpError(409, `You already logged "${rec.file_name}" for "${measure.name}" on ${date}.`, { field: 'measure' });
  const note = body.note !== undefined ? str(body.note, 300) : rec.note;
  db.prepare(`UPDATE records SET date=?, measure_id=?, patients=?, rate_cents=?, note=?, updated_at=datetime('now') WHERE id=?`)
    .run(date, measure.id, patients, measure.rate_cents, note, rec.id);
  broadcast('record.updated', { ownerId: user.id });
  send(res, 200, { item: getRecord(rec.id) });
});

route('DELETE', /^\/api\/records\/(\d+)$/, {}, async (req, res, { user, params }) => {
  const rec = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(params[0]));
  if (!rec || rec.user_id !== user.id) throw new HttpError(404, 'Record not found.');
  if (rec.status !== 'pending') throw new HttpError(409, 'Only records awaiting approval can be deleted.');
  db.prepare('DELETE FROM records WHERE id = ?').run(rec.id);
  broadcast('record.deleted', { ownerId: user.id });
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/records\/review$/, { admin: true }, async (req, res, { user }) => {
  const body = await readJson(req);
  const action = body.action;
  if (!['approve', 'reject'].includes(action)) throw bad('Unknown review action.');
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger))].slice(0, 500);
  if (!ids.length) throw bad('Select at least one record.');
  const reason = str(body.reason, 300);
  if (action === 'reject' && reason.length < 3) throw bad('Please give the employee a reason for rejecting.', { field: 'reason' });
  const status = action === 'approve' ? 'approved' : 'rejected';
  const placeholders = ids.map(() => '?').join(',');
  const affected = db.prepare(`SELECT id, user_id, patients, rate_cents FROM records WHERE status='pending' AND id IN (${placeholders})`).all(...ids);
  if (affected.length) {
    db.prepare(`UPDATE records SET status=?, reviewed_by=?, reviewed_at=datetime('now'), reject_reason=?, updated_at=datetime('now')
      WHERE status='pending' AND id IN (${affected.map(() => '?').join(',')})`)
      .run(status, user.id, action === 'reject' ? reason : '', ...affected.map((a) => a.id));
  }
  // one event per affected employee so each gets a personal notification
  const byOwner = new Map();
  for (const a of affected) {
    const o = byOwner.get(a.user_id) || { count: 0, patients: 0 };
    o.count += 1; o.patients += a.patients;
    byOwner.set(a.user_id, o);
  }
  for (const [ownerId, o] of byOwner) broadcast('record.reviewed', { ownerId, status, ...o });
  send(res, 200, { updated: affected.length, skipped: ids.length - affected.length });
});

// stats
route('GET', /^\/api\/stats\/me$/, {}, async (req, res, { user, url }) => {
  const { from, to, prev } = range(url.searchParams);
  const board = leaderboard(from, to, 'patients', prev);
  const mine = board.rows.find((r) => r.id === user.id);
  // the person directly above, so the dashboard can show "N patients to reach #X"
  const above = mine && mine.rank > 1 ? board.rows.filter((r) => r.rank < mine.rank).pop() : null;
  const chase = above ? { rank: above.rank, name: above.name, patients: above.patients, gap: above.patients - mine.patients + 1 } : null;
  const lifetime = db.prepare(`SELECT COALESCE(SUM(patients*rate_cents),0) AS cents, COALESCE(SUM(patients),0) AS patients
    FROM records WHERE user_id=? AND status='approved'`).get(user.id);
  const dates = db.prepare(`SELECT DISTINCT date FROM records WHERE user_id=? AND status!='rejected' AND date >= ? ORDER BY date DESC`)
    .all(user.id, calc.addDays(calc.todayIso(), -120)).map((r) => r.date);
  send(res, 200, {
    from, to, prevFrom: prev.from, prevTo: prev.to,
    summary: periodSummary(user.id, from, to),
    previous: periodSummary(user.id, prev.from, prev.to),
    series: dailySeries(user.id, from, to),
    measures: measureBreakdown(user.id, from, to),
    rank: mine ? mine.rank : null, employees: board.employees, chase, leader: board.rows[0]?.patients || 0,
    teamAverage: board.employees ? Math.round(board.totals.patients / board.employees) : 0,
    lifetime, streak: calc.workdayStreak(dates, calc.todayIso()),
    loggedToday: dates.includes(calc.todayIso()),
  });
});

route('GET', /^\/api\/leaderboard$/, {}, async (req, res, { url, user }) => {
  const { from, to, prev } = range(url.searchParams);
  // Ranked by patients only; incentive amounts are private and never sent with the leaderboard.
  const board = leaderboard(from, to, 'patients', prev);
  const { amount_cents: _total, ...totals } = board.totals;
  const rows = board.rows.map(({ amount_cents: _amt, ...r }) => r);
  // All-time approved patients, independent of the selected period: the viewer's own (employees) and the team's.
  const allTime = db.prepare(`SELECT
      COALESCE(SUM(r.patients),0) AS team,
      COALESCE(SUM(CASE WHEN r.user_id = ? THEN r.patients END),0) AS mine
    FROM records r JOIN users u ON u.id = r.user_id
    WHERE r.status='approved' AND u.role='employee' AND u.active=1`).get(user.id);
  send(res, 200, { ...board, totals, rows, allTime, hallOfFame: hallOfFame() });
});

route('GET', /^\/api\/admin\/overview$/, { admin: true }, async (req, res, { url }) => {
  const { from, to, prev } = range(url.searchParams);
  const pending = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(patients),0) AS patients,
      COALESCE(SUM(patients*rate_cents),0) AS amount_cents, MIN(date) AS oldest
    FROM records WHERE status='pending'`).get();
  const reviewedToday = db.prepare(`SELECT COUNT(*) AS n FROM records WHERE status!='pending' AND date(reviewed_at) = date('now')`).get().n;
  const employees = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='employee' AND active=1`).get().n;
  send(res, 200, {
    from, to, pending, reviewedToday, employees,
    summary: periodSummary(null, from, to), previous: periodSummary(null, prev.from, prev.to),
    series: dailySeries(null, from, to), measures: measureBreakdown(null, from, to),
    online: clients.size,
  });
});

// users
route('GET', /^\/api\/users$/, { admin: true }, async (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.title, u.color, u.active, u.created_at,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN r.patients END),0) AS patients,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN r.patients*r.rate_cents END),0) AS amount_cents,
      COUNT(CASE WHEN r.status='pending' THEN 1 END) AS pending,
      COUNT(r.id) AS records,
      MAX(r.date) AS last_entry
    FROM users u LEFT JOIN records r ON r.user_id = u.id
    GROUP BY u.id ORDER BY u.role DESC, u.active DESC, u.name`).all();
  send(res, 200, { items: rows.map((u) => ({ ...u, active: !!u.active })) });
});

const PALETTE = ['#0E7490', '#047857', '#B45309', '#4338CA', '#BE123C', '#0369A1', '#7C2D12', '#15803D', '#9D174D', '#1D4ED8'];
route('POST', /^\/api\/users$/, { admin: true }, async (req, res) => {
  const body = await readJson(req);
  const name = str(body.name, 80);
  const email = str(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'admin' ? 'admin' : 'employee';
  if (name.length < 2) throw bad('Enter the employee’s full name.', { field: 'name' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address.', { field: 'email' });
  if (password.length < 8) throw bad('Temporary password must be at least 8 characters.', { field: 'password' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Someone already uses that email.', { field: 'email' });
  const color = PALETTE[crypto.randomInt(PALETTE.length)];
  const id = Number(db.prepare('INSERT INTO users (name, email, password_hash, role, title, color) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, email, dbm.hashPassword(password), role, str(body.title, 80), color).lastInsertRowid);
  broadcast('user.changed', { userId: id });
  send(res, 201, { item: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

route('PATCH', /^\/api\/users\/(\d+)$/, { admin: true }, async (req, res, { user, params }) => {
  const id = Number(params[0]);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'User not found.');
  const body = await readJson(req);
  if (body.active !== undefined) {
    if (id === user.id && !body.active) throw bad('You cannot deactivate your own account.');
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
    if (!body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (body.title !== undefined) db.prepare('UPDATE users SET title = ? WHERE id = ?').run(str(body.title, 80), id);
  if (body.name !== undefined) {
    const name = str(body.name, 80);
    if (name.length < 2) throw bad('Enter the employee’s full name.', { field: 'name' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  }
  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < 8) throw bad('Password must be at least 8 characters.', { field: 'password' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(dbm.hashPassword(body.password), id);
  }
  broadcast('user.changed', { userId: id });
  send(res, 200, { item: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

// Permanently removes an employee and all their records (deactivating keeps them). Admin accounts can't be deleted.
route('DELETE', /^\/api\/users\/(\d+)$/, { admin: true }, async (req, res, { params }) => {
  const id = Number(params[0]);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'User not found.');
  if (u.role !== 'employee') throw bad('Only employee accounts can be deleted.');
  let records;
  db.exec('BEGIN');
  try {
    records = Number(db.prepare('DELETE FROM records WHERE user_id = ?').run(id).changes);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  broadcast('user.changed', { userId: id });
  send(res, 200, { ok: true, records });
});

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    // always revalidate so deploys show up immediately; unchanged files cost a 304
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(500); return res.end(); }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  }
  try {
    const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
    if (!r) throw new HttpError(404, 'Not found');
    const params = url.pathname.match(r.pattern).slice(1);
    let user = null;
    if (r.opts.auth !== false) {
      user = currentUser(req);
      if (!user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
      if (r.opts.admin && user.role !== 'admin') throw new HttpError(403, 'Administrator access required.');
    }
    await r.handler(req, res, { user, url, params });
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.details || {}) });
    console.error(err);
    send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

// Keep idle connections open longer than Caddy does (2 min), or Caddy may reuse one Node just closed and
// answer 502. headersTimeout must stay above keepAliveTimeout.
server.keepAliveTimeout = 125_000;
server.headersTimeout = 130_000;

server.listen(PORT, HOST, () => {
  console.log(`Incentive Tracker running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
