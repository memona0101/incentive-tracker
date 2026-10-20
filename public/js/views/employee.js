// Employee views: dashboard, log record, history.
import {
  html, raw, $, $$, api, qs, state, store, icon, num, plural, fmtDate, monthShort, dayNum, greeting, todayIso, addDays,
  periodRange, periodPicker, PERIODS, delta, counter, countUp, statusBadge, emptyState,
  toast, confirmDialog, setBusy, fieldError, relTime, fmtDateTime, debounce, celebrate,
} from '../lib.js';

const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

function recordItem(r) {
  return html`<div class="rec-item" data-id="${r.id}">
    <div class="rec-date" aria-hidden="true"><div class="d">${dayNum(r.date)}</div><div class="m">${monthShort(r.date)}</div></div>
    <div class="rec-main"><div class="t" title="${r.file_name}">${r.file_name || r.measure_name}</div>
      <div class="s">${r.file_name ? `${r.measure_name} · ` : ''}${fmtDate(r.date, { dow: true })}</div></div>
    <div class="rec-amt"><div class="v">${plural(r.patients, 'patient')}</div>${statusBadge(r.status)}</div>
  </div>`;
}

// =================================================================== dashboard
export async function dashboard({ root, isStale }) {
  const ac = new AbortController();
  let period = store.get('it-period', 'month');
  let last = {};

  async function load() {
    const r = periodRange(period);
    const [s, recent] = await Promise.all([
      api('GET', `/api/stats/me?${qs(r.query)}`),
      api('GET', '/api/records?limit=6'),
    ]);
    if (isStale()) return;
    render(s, recent.items, r);
  }

  function render(s, recent, r) {
    const u = state.user; const sum = s.summary; const prev = s.previous;
    const first = u.name.split(' ')[0];
    root.innerHTML = String(html`
      <section class="hx" aria-labelledby="hx-h">
        <div class="hx-main">
          <span class="hx-eyebrow">${fmtDate(todayIso(), { dow: true, year: true })}</span>
          <h1 id="hx-h">${greeting()}, ${first}</h1>
          <p class="hx-status"><span class="hx-dot ${s.loggedToday ? 'done' : ''}" aria-hidden="true"></span>
            ${s.loggedToday ? 'Today’s work is submitted. An administrator will review it shortly.' : 'You haven’t submitted anything today yet.'}</p>
          <div class="hx-actions">
            <a class="btn hx-btn" href="#/log">${icon('plus')}${s.loggedToday ? 'Submit more' : 'Submit today’s work'}</a>
            <a class="btn hx-btn-ghost" href="#/history">${icon('history')}My history</a>
          </div>
          <div class="hx-chips">
            <span class="hx-chip" title="Workdays in a row with a submission">${icon('flame', 'sm')}${s.streak ? html`<b>${num(s.streak)}</b>-day streak` : 'Start a streak today'}</span>
            <span class="hx-chip" title="Approved patients, all time">${icon('heart', 'sm')}<b>${num(s.lifetime.patients)}</b> all-time patients</span>
          </div>
        </div>
        <img class="hx-art" src="/img/woman-laptop.png" alt="" aria-hidden="true" width="226" height="340">
        ${rankPanel(s, sum, r)}
      </section>

      ${sum.rejected_count ? html`<div class="alert warn" style="margin-top:16px" role="status">${icon('alert')}<span>
        ${plural(sum.rejected_count, 'record was', 'records were')} rejected in this period. <a href="#/history?status=rejected">See why</a>.</span></div>` : ''}

      <div class="section-head"><h2>Your numbers</h2>${periodPicker(period)}</div>
      <div class="kpis kpis-3">
        <div class="card kpi"><div class="top"><span class="label">Approved patients</span><span class="ico money">${icon('check')}</span></div>
          <div class="value">${counter(sum.approved_patients, 'num', last.approved_patients)}</div>
          <div class="foot">${delta(sum.approved_patients, prev.approved_patients, r.prev)}</div></div>
        <div class="card kpi"><div class="top"><span class="label">Awaiting review</span><span class="ico warn">${icon('clock')}</span></div>
          <div class="value">${counter(sum.pending_patients, 'num', last.pending_patients)}</div>
          <div class="foot">${plural(sum.pending_count, 'submission')}</div></div>
        <div class="card kpi"><div class="top"><span class="label">Submissions</span><span class="ico ink">${icon('file')}</span></div>
          <div class="value">${counter(sum.approved_count + sum.pending_count, 'num', last.records)}</div>
          <div class="foot">${plural(sum.approved_count, 'approved', 'approved')} · ${num(sum.rejected_count)} rejected</div></div>
      </div>

      <section class="card" style="margin-top:16px" aria-labelledby="recent-h">
        <div class="card-head" style="padding-bottom:12px"><h2 id="recent-h">Recent submissions</h2>
          <a class="btn btn-ghost btn-sm" href="#/history">View all ${icon('chevronRight', 'sm')}</a></div>
        ${recent.length ? html`<div class="rec-list">${recent.map(recordItem)}</div>`
          : emptyState('inbox', 'Nothing submitted yet', 'Submit your first work to start counting toward the leaderboard.', html`<a class="btn btn-primary" href="#/log">${icon('plus')}Submit work</a>`)}
      </section>`);
    countUp(root);
    last = { approved_patients: sum.approved_patients, pending_patients: sum.pending_patients, records: sum.approved_count + sum.pending_count };
  }

  // White panel inside the hero: current rank and a progress bar toward the next place up.
  function rankPanel(s, sum, r) {
    const label = PERIODS.find((p) => p.key === period).label;
    if (!s.rank) return html`<div class="hx-rank"><span class="hx-rank-label">${label}</span><div class="hx-rank-big">—</div><p class="hx-next">Get records approved to join the leaderboard.</p></div>`;
    const pct = s.chase ? Math.min(100, Math.round((sum.approved_patients / Math.max(1, s.chase.patients + 1)) * 100)) : 100;
    return html`<a class="hx-rank" href="#/leaderboard" aria-label="Your rank: ${s.rank} of ${s.employees}. Open the leaderboard">
      <span class="hx-rank-label">${icon('trophy', 'sm')}Your rank · ${label}</span>
      <div class="hx-rank-big">#${s.rank} <small>of ${s.employees}</small></div>
      <div class="hx-bar" role="progressbar" aria-label="Progress to the next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${raw(String(pct))}%"></span></div>
      <p class="hx-next">${s.chase ? html`<b>${plural(s.chase.gap, 'patient')}</b> to pass ${s.chase.name.split(' ')[0]} for #${s.chase.rank}` : html`<b>You’re leading the team.</b> Keep it up!`}</p>
      <span class="hx-rank-link">View leaderboard ${icon('chevronRight', 'sm')}</span>
    </a>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action="period"]'); if (!b) return;
    period = b.dataset.value; store.set('it-period', period); last = {};
    load();
  }, { signal: ac.signal });

  await load();
  return { onLive: load, destroy: () => ac.abort() };
}

// =================================================================== log record
export async function logRecord({ root, isStale }) {
  const ac = new AbortController();
  let { items: files } = await api('GET', '/api/files');
  if (isStale()) return;
  const fileById = (id) => files.find((f) => f.id === Number(id));
  const max = state.config.maxPatients;
  const MAX_ROWS = 20;
  const minDate = addDays(todayIso(), -state.config.backdateLimitDays);
  let keySeq = 0;
  const newRow = () => ({ key: ++keySeq, fileId: '', measureName: '', patients: 1 });
  let date = todayIso();
  let rows = [newRow()];
  let existing = [];

  const normName = (v) => String(v || '').trim().replace(/\s+/g, ' ');
  const fileKey = (fileName, measureName) => `${normName(measureName).toLowerCase()}|${fileName.trim().toLowerCase()}`;
  const validPatients = (row) => (Number.isInteger(Number(row.patients)) && row.patients >= 1 && row.patients <= max ? Number(row.patients) : 0);
  const isComplete = (row) => fileById(row.fileId) && normName(row.measureName).length >= 1 && validPatients(row);

  function rowHtml(row, i) {
    return html`<div class="entry-row" data-key="${row.key}">
      <div class="entry-head"><span class="t">File ${i + 1}</span>
        <button type="button" class="icon-btn danger" data-remove aria-label="Remove file ${i + 1}" ${rows.length === 1 ? raw('disabled style="visibility:hidden"') : ''}>${icon('trash', 'sm')}</button></div>
      <div class="field"><label for="f-${row.key}">File name</label>
        <select class="select" id="f-${row.key}" name="file-${row.key}" data-field="fileId" required ${files.length ? '' : raw('disabled')}>
          <option value="">${files.length ? 'Select a file…' : 'No files available yet'}</option>
          ${files.map((f) => html`<option value="${f.id}" ${Number(row.fileId) === f.id ? raw('selected') : ''}>${f.name}</option>`)}
        </select></div>
      <div class="field"><label for="m-${row.key}">Measure</label>
        <input class="input" id="m-${row.key}" name="measure-${row.key}" data-field="measureName" type="text" maxlength="80" autocomplete="off"
          placeholder="e.g. Annual Wellness Visit or 101" value="${row.measureName}" aria-describedby="mh-${row.key}" required>
        <div class="hint" id="mh-${row.key}">Type the measure name or number.</div></div>
      <div class="field"><label for="p-${row.key}">Patients</label>
        <div class="stepper"><button type="button" data-step="-1" aria-label="Decrease patients">${icon('minus', 'sm')}</button>
          <input id="p-${row.key}" name="patients-${row.key}" data-field="patients" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${row.patients}" aria-describedby="ph-${row.key}" required>
          <button type="button" data-step="1" aria-label="Increase patients">${icon('plus', 'sm')}</button></div>
        <div class="hint" id="ph-${row.key}" aria-live="polite">Whole number from 1 to ${num(max)}.</div></div>
    </div>`;
  }

  function renderPage() {
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Submit work</h1><p>Add each file you worked on, its measure and how many patients it covered.</p></div></div>
      <div class="cols-2-1">
        <form class="card" id="log-form" novalidate>
          <div class="card-body" style="display:grid;gap:20px;padding-top:20px">
            <div class="field" style="max-width:340px"><label for="log-date">Date</label>
              <input class="input" type="date" id="log-date" name="date" value="${date}" min="${minDate}" max="${todayIso()}" required>
              <div class="date-quick">
                <button type="button" class="chip" data-date="${todayIso()}" aria-pressed="${date === todayIso()}">Today</button>
                <button type="button" class="chip" data-date="${addDays(todayIso(), -1)}" aria-pressed="${date === addDays(todayIso(), -1)}">Yesterday</button>
              </div>
              <div class="hint">You can log up to ${state.config.backdateLimitDays} days back.</div></div>
            <div class="entry-rows" id="rows"></div>
            <button type="button" class="add-row" data-add>${icon('plus')}Add another file name</button>
          </div>
        </form>
        <aside class="stack">
          <section class="card card-pad summary-card" aria-labelledby="sum-h">
            <h2 id="sum-h" style="font-size:14px;color:var(--text-2);font-weight:600">Total patients</h2>
            <div class="summary-total" id="sum-total">0</div>
            <div class="muted" style="font-size:13px" id="sum-sub"></div>
            <div class="summary-lines" id="sum-lines"></div>
            <button class="btn btn-primary btn-block" type="submit" form="log-form" id="submit-btn">${icon('check')}Submit for approval</button>
            <p class="muted" style="font-size:12.5px;margin-top:12px;display:flex;gap:8px">${icon('lock', 'sm')}<span>An administrator reviews each record. Approved patients count toward your dashboard and the leaderboard.</span></p>
          </section>
          <section class="card" aria-labelledby="exist-h"><div class="card-head" style="padding-bottom:8px"><div><h2 id="exist-h">Already logged</h2><div class="sub" id="exist-sub"></div></div></div>
            <div id="existing"></div></section>
        </aside>
      </div>`);
    renderRows(); updateSummary(); loadExisting();
  }

  function renderRows() {
    const box = $('#rows', root); if (!box) return;
    for (const r of rows) if (r.fileId && !fileById(r.fileId)) r.fileId = ''; // file was hidden by an admin
    const notice = files.length ? '' : html`<div class="alert warn" role="status">${icon('alert')}<span>No files are available yet. Ask an administrator to add one on the Files page.</span></div>`;
    box.innerHTML = String(html`${notice}${rows.map(rowHtml)}`);
  }

  function updateSummary() {
    if (!$('#sum-total', root)) return;
    const valid = rows.filter(isComplete);
    const patients = valid.reduce((a, r) => a + validPatients(r), 0);
    $('#sum-total', root).textContent = num(patients);
    $('#sum-sub', root).textContent = valid.length ? `Across ${plural(valid.length, 'file')} · ${fmtDate(date, { dow: true })}` : 'Enter a file name and measure to get started';
    $('#sum-lines', root).innerHTML = valid.length
      ? String(html`${valid.map((r) => html`<div class="line"><span title="${fileById(r.fileId).name} · ${normName(r.measureName)}">${fileById(r.fileId).name} · ${normName(r.measureName)}</span><span>${plural(validPatients(r), 'patient')}</span></div>`)}`)
      : '<div class="line"><span>No files added yet</span><span></span></div>';
    $('#submit-btn', root).disabled = !valid.length;
  }

  async function loadExisting() {
    const box = $('#existing', root); const sub = $('#exist-sub', root);
    if (!box) return;
    sub.textContent = fmtDate(date, { dow: true, year: true });
    try {
      const res = await api('GET', `/api/records?${qs({ from: date, to: date, limit: 50 })}`);
      existing = res.items;
      box.innerHTML = existing.length ? String(html`<div class="rec-list">${existing.map(recordItem)}</div>`)
        : String(html`<p class="muted" style="padding:4px 20px 20px;font-size:14px">Nothing logged for this date yet.</p>`);
    } catch (err) { box.innerHTML = String(html`<p class="muted" style="padding:4px 20px 20px">${err.message}</p>`); }
  }

  function rowFor(el) { const k = Number(el.closest('.entry-row')?.dataset.key); return rows.find((r) => r.key === k); }
  function setDate(next) {
    date = next; $('#log-date', root).value = date;
    $$('[data-date]', root).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.date === date)));
    updateSummary(); loadExisting();
  }

  root.addEventListener('input', (e) => {
    const t = e.target;
    const row = rowFor(t); if (!row) return;
    if (t.dataset.field === 'patients') row.patients = t.value === '' ? '' : Number(t.value);
    if (t.dataset.field === 'fileId') row.fileId = t.value;
    if (t.dataset.field === 'measureName') row.measureName = t.value;
    if (t.getAttribute('aria-invalid')) fieldError($('#log-form', root), null, null);
    if (t.dataset.field === 'patients') checkPatients(row);
    updateSummary();
  }, { signal: ac.signal });

  // Flag an out-of-range patient count as soon as it's typed, instead of silently leaving it out of the total.
  function checkPatients(row) {
    const hint = $(`#ph-${row.key}`, root); if (!hint) return;
    const bad = row.patients !== '' && !validPatients(row);
    hint.textContent = bad ? `Enter a whole number from 1 to ${num(max)}. This entry isn’t counted yet.` : `Whole number from 1 to ${num(max)}.`;
    hint.classList.toggle('bad', bad);
    hint.previousElementSibling?.classList.toggle('invalid', bad);
  }

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'log-date') { if (t.value) setDate(t.value); return; }
    const row = rowFor(t); if (!row) return;
  }, { signal: ac.signal });

  root.addEventListener('click', (e) => {
    const t = e.target;
    const step = t.closest('[data-step]');
    if (step) {
      const row = rowFor(step); const input = step.parentElement.querySelector('input');
      const v = Math.min(max, Math.max(1, (Number(input.value) || 0) + Number(step.dataset.step)));
      input.value = v; row.patients = v; checkPatients(row); updateSummary(); return;
    }
    if (t.closest('[data-add]')) {
      if (rows.length >= MAX_ROWS) return toast('info', `Up to ${MAX_ROWS} files at a time`, 'Submit these first, then log the rest.');
      rows.push(newRow()); renderRows(); updateSummary();
      document.getElementById(`f-${keySeq}`)?.focus(); return;
    }
    const rm = t.closest('[data-remove]');
    if (rm) { const row = rowFor(rm); rows = rows.filter((r) => r !== row); renderRows(); updateSummary(); return; }
    const chip = t.closest('[data-date]');
    if (chip) { setDate(chip.dataset.date); return; }
    if (t.closest('[data-again]')) { rows = [newRow()]; renderPage(); }
  }, { signal: ac.signal });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = $('#log-form', root);
    fieldError(form, null, null);
    const seen = new Set();
    const logged = new Set(existing.filter((r) => r.status !== 'rejected').map((r) => fileKey(r.file_name, r.measure_name)));
    for (const r of rows) {
      if (!fileById(r.fileId)) return fieldError(form, `file-${r.key}`, 'Choose a file, or remove this entry.');
      if (!normName(r.measureName)) return fieldError(form, `measure-${r.key}`, 'Enter the measure name or number for this file.');
      if (!validPatients(r)) return fieldError(form, `patients-${r.key}`, `Enter a whole number from 1 to ${max}.`);
      const k = fileKey(fileById(r.fileId).name, r.measureName);
      if (seen.has(k)) return fieldError(form, `file-${r.key}`, 'This file and measure are already listed above.');
      if (logged.has(k)) return fieldError(form, `file-${r.key}`, 'You already logged this file and measure for this date.');
      seen.add(k);
    }
    const btn = $('#submit-btn', root);
    setBusy(btn, true, 'Submitting…');
    try {
      const { items } = await api('POST', '/api/records', {
        date, entries: rows.map((r) => ({ fileId: Number(r.fileId), measureName: normName(r.measureName), patients: validPatients(r) })),
      });
      const patients = items.reduce((a, r) => a + r.patients, 0);
      toast('success', 'Submitted for approval', `${plural(items.length, 'file')} · ${plural(patients, 'patient')} sent for review.`);
      root.querySelector('.cols-2-1 > form').outerHTML = String(html`<section class="card"><div class="success-burst">
        <div class="check">${icon('check')}</div>
        <h2 style="font-size:22px;font-weight:800">Submitted — thank you.</h2>
        <p class="muted" style="margin-top:6px">${plural(patients, 'patient')} across ${plural(items.length, 'file')} on ${fmtDate(date, { dow: true })}.</p>
        <p class="muted" style="font-size:13px;margin-top:10px">Pending approval — we’ll notify you the moment it’s reviewed.</p>
        <div class="form-actions" style="justify-content:center;margin-top:20px">
          <button class="btn btn-secondary" type="button" data-again>${icon('plus')}Submit more</button>
          <a class="btn btn-primary" href="#/dashboard">Back to dashboard</a></div></div></section>`);
      root.querySelector('.summary-card')?.remove();
      celebrate(root.querySelector('.success-burst .check'));
      loadExisting();
    } catch (err) {
      setBusy(btn, false);
      const m = /^entries\.(\d+)\.(file|measure|patients)$/.exec(err.field || '');
      const target = m ? `${m[2]}-${rows[Number(m[1])]?.key}` : err.field === 'date' ? 'date' : null;
      fieldError(form, target, err.message);
    }
  }, { signal: ac.signal });

  renderPage();
  return {
    onLive: async (evt) => {
      if (evt.ownerId === state.user.id) loadExisting();
      if (evt.type === 'file.changed') { ({ items: files } = await api('GET', '/api/files')); renderRows(); updateSummary(); }
    },
    destroy: () => ac.abort(),
  };
}

// =================================================================== history
export async function history({ root, isStale }) {
  const ac = new AbortController();
  const hp = hashParams();
  const f = { status: hp.get('status') || '', from: '', to: '', q: '', page: 1 };
  const LIMIT = 15;
  let data = { items: [], total: 0, totals: {} };
  let lastIds = null;

  root.innerHTML = String(html`
    <div class="page-head"><div><h1>My history</h1><p>Every record you’ve submitted, with its review status.</p></div>
      <div class="actions"><a class="btn btn-secondary" id="csv" href="#" download>${icon('download')}Export CSV</a>
        <a class="btn btn-primary" href="#/log">${icon('plus')}Submit work</a></div></div>
    <section class="card">
      <div class="filters" role="search">
        <div class="input-icon grow">${icon('search', 'sm')}<input class="input" type="search" name="q" placeholder="Search file name or measure" aria-label="Search records"></div>
        <div class="segmented" role="group" aria-label="Status filter">
          ${[['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([v, l]) => html`<button type="button" data-status="${v}" aria-pressed="${f.status === v}">${l}</button>`)}
        </div>
        <input class="input" type="date" name="from" aria-label="From date">
        <input class="input" type="date" name="to" aria-label="To date">
      </div>
      <div id="list"></div>
    </section>`);

  async function load() {
    const params = { ...f, limit: LIMIT };
    const res = await api('GET', `/api/records?${qs(params)}`);
    if (isStale()) return;
    const prevIds = lastIds; data = res; lastIds = new Set(res.items.map((r) => r.id));
    $('#csv', root).href = `/api/records.csv?${qs({ status: f.status, from: f.from, to: f.to, q: f.q })}`;
    const pages = Math.max(1, Math.ceil(data.total / LIMIT));
    const list = $('#list', root);
    if (!data.items.length) {
      list.innerHTML = String(emptyState('inbox', 'No records match', 'Try a different filter, or log a new record.'));
      return;
    }
    list.innerHTML = String(html`<div class="table-wrap"><table class="table cards">
      <thead><tr><th scope="col">Date</th><th scope="col">File name</th><th scope="col" class="r">Patients handled</th><th scope="col">Submitted at</th><th scope="col">Status</th><th scope="col" class="r">Actions</th></tr></thead>
      <tbody>${data.items.map((r) => html`<tr data-id="${r.id}" class="${prevIds && !prevIds.has(r.id) ? 'flash' : ''}">
        <td class="num c-date" style="white-space:nowrap">${fmtDate(r.date, { dow: true })}</td>
        <td class="c-measure"><div style="font-weight:600;word-break:break-word">${r.file_name || '—'}</div><div class="note">${r.measure_name}</div>${r.note ? html`<div class="note">${r.note}</div>` : ''}
          ${r.status === 'rejected' && r.reject_reason ? html`<div class="reason">${icon('alert', 'sm')}<span>${r.reject_reason}</span></div>` : ''}</td>
        <td class="r num c-pat" style="font-weight:700" data-suffix="${r.patients === 1 ? 'patient' : 'patients'}">${num(r.patients)}</td>
        <td class="num c-sub" style="white-space:nowrap">${fmtDateTime(r.created_at)}</td>
        <td class="c-status">${statusBadge(r.status)}${r.reviewed_at ? html`<div class="note">${r.reviewer_name ? `by ${r.reviewer_name.split(' ')[0]} · ` : ''}${relTime(r.reviewed_at)}</div>` : ''}</td>
        <td class="c-act"><div class="actions">${r.status === 'pending' ? html`
          <button class="icon-btn danger" type="button" data-delete="${r.id}" aria-label="Delete record">${icon('trash', 'sm')}</button>` : ''}</div></td>
      </tr>`)}</tbody></table></div>
      <div class="table-foot">
        <div class="totals-strip"><span><b>${num(data.total)}</b> records</span><span><b>${num(data.totals.patients)}</b> patients</span></div>
        <div class="pager"><span>Page ${f.page} of ${pages}</span>
          <button class="icon-btn bordered" type="button" data-page="-1" aria-label="Previous page" ${f.page <= 1 ? raw('disabled') : ''}>${icon('chevronLeft', 'sm')}</button>
          <button class="icon-btn bordered" type="button" data-page="1" aria-label="Next page" ${f.page >= pages ? raw('disabled') : ''}>${icon('chevronRight', 'sm')}</button></div>
      </div>`);
  }

  const reload = () => { f.page = 1; load(); };
  const onSearch = debounce(reload, 250);
  root.addEventListener('input', (e) => { if (e.target.name === 'q') { f.q = e.target.value.trim(); onSearch(); } }, { signal: ac.signal });
  root.addEventListener('change', (e) => {
    const n = e.target.name;
    if (['from', 'to'].includes(n)) { f[n] = e.target.value; reload(); }
  }, { signal: ac.signal });
  root.addEventListener('click', async (e) => {
    const t = e.target;
    const st = t.closest('[data-status]');
    if (st) { f.status = st.dataset.status; $$('[data-status]', root).forEach((b) => b.setAttribute('aria-pressed', String(b === st))); return reload(); }
    const pg = t.closest('[data-page]');
    if (pg) { f.page += Number(pg.dataset.page); return load(); }
    const del = t.closest('[data-delete]');
    if (del) {
      const r = data.items.find((x) => x.id === Number(del.dataset.delete));
      const ok = await confirmDialog({ title: 'Delete this record?', desc: `${r.file_name ? `${r.file_name} · ` : ''}${r.measure_name} · ${plural(r.patients, 'patient')} on ${fmtDate(r.date)}. This can’t be undone.`, confirmLabel: 'Delete record', danger: true });
      if (!ok) return;
      try { await api('DELETE', `/api/records/${r.id}`); toast('success', 'Record deleted'); load(); }
      catch (err) { toast('error', 'Couldn’t delete', err.message); }
    }
  }, { signal: ac.signal });

  await load();
  return { onLive: (evt) => { if (!evt.ownerId || evt.ownerId === state.user.id) load(); }, destroy: () => ac.abort() };
}

