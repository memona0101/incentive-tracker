// Admin views: overview, approvals queue, team, measures.
import {
  html, raw, $, $$, api, qs, state, store, icon, num, plural, fmtDate, todayIso, periodRange, periodPicker, PERIODS,
  avatar, counter, countUp, delta, statusBadge, emptyState, toast, modal, confirmDialog, setBusy,
  fieldError, relTime, fmtDateTime, debounce, greeting,
} from '../lib.js';

// =================================================================== overview
// Kept deliberately small: what's waiting, three key numbers, and a quick-approve list.
export async function overview({ root, isStale }) {
  const ac = new AbortController();
  let period = store.get('it-admin-period', 'month');
  let last = {};

  async function load() {
    const r = periodRange(period);
    const [o, queue, feed] = await Promise.all([
      api('GET', `/api/admin/overview?${qs(r.query)}`),
      api('GET', '/api/records?status=pending&sort=oldest&limit=6'),
      api('GET', '/api/records?sort=recent&limit=8'),
    ]);
    if (isStale()) return;
    const sum = o.summary; const prev = o.previous;
    const first = state.user.name.split(' ')[0];
    root.innerHTML = String(html`
      <section class="hx hx-admin" aria-labelledby="hx-h">
        <div class="hx-main">
          <span class="hx-eyebrow">${fmtDate(todayIso(), { dow: true, year: true })}</span>
          <h1 id="hx-h">${greeting()}, ${first}</h1>
          <p class="hx-status"><span class="hx-dot ${o.pending.count ? '' : 'done'}" aria-hidden="true"></span>
            <span>${o.pending.count ? html`<b>${plural(o.pending.count, 'submission')}</b> (${plural(o.pending.patients, 'patient')}) waiting for your review.` : 'You’re all caught up. Nothing is waiting for review.'}</span></p>
          <div class="hx-actions">
            <a class="btn hx-btn" href="#/admin/approvals">${icon('approvals')}${o.pending.count ? 'Review queue' : 'Open approvals'}</a>
            <a class="btn hx-btn-ghost" href="#/leaderboard">${icon('trophy')}Leaderboard</a>
          </div>
          <div class="hx-chips">
            <span class="hx-chip">${icon('users', 'sm')}<b>${num(o.employees)}</b> active employees</span>
            <span class="hx-chip" title="People with the app open right now"><span class="hx-live" aria-hidden="true"></span><b>${num(o.online)}</b> online now</span>
          </div>
        </div>
        <img class="hx-art hx-art-wide" src="/img/office-talk.png" alt="" aria-hidden="true" width="400" height="264">
        ${queuePanel(o)}
      </section>

      <div class="section-head"><h2>Team numbers</h2>${periodPicker(period)}</div>
      <div class="kpis kpis-3">
        <div class="card kpi"><div class="top"><span class="label">Approved patients</span><span class="ico money">${icon('check')}</span></div>
          <div class="value">${counter(sum.approved_patients, 'num', last.patients)}</div>
          <div class="foot">${delta(sum.approved_patients, prev.approved_patients, r.prev)}</div></div>
        <div class="card kpi"><div class="top"><span class="label">Waiting for review</span><span class="ico warn">${icon('clock')}</span></div>
          <div class="value">${counter(o.pending.patients, 'num', last.pending)} <small>patients</small></div>
          <div class="foot">${plural(o.pending.count, 'submission')}</div></div>
        <div class="card kpi"><div class="top"><span class="label">Active employees</span><span class="ico ink">${icon('users')}</span></div>
          <div class="value">${num(o.employees)}</div>
          <div class="foot"><a href="#/admin/team">Manage team</a></div></div>
      </div>

      <div class="cols-2-1 ov-cols">
      <section class="card" aria-labelledby="needs-h">
        <div class="card-head" style="padding-bottom:12px"><h2 id="needs-h">Needs your review</h2>
          ${o.pending.count ? html`<a class="btn btn-ghost btn-sm" href="#/admin/approvals">View all ${num(o.pending.count)} ${icon('chevronRight', 'sm')}</a>` : ''}</div>
        ${queue.items.length ? html`<div class="rec-list">${queue.items.map((q) => html`<div class="rec-item review-row" data-id="${q.id}">
            ${avatar({ name: q.user_name, color: q.user_color }, 'sm')}
            <div class="rec-main"><div class="t">${q.user_name}</div>
              <div class="s">${q.file_name ? `${q.file_name} · ` : ''}${q.measure_name} · ${fmtDate(q.date)}</div></div>
            <div class="review-pat">${plural(q.patients, 'patient')}</div>
            <button class="btn btn-secondary btn-sm" type="button" data-approve="${q.id}" aria-label="Approve ${q.user_name}'s ${q.measure_name} on ${fmtDate(q.date)}">${icon('check', 'sm')}Approve</button>
          </div>`)}</div>
          <p class="review-note">To reject a submission, open the queue so you can add a reason.</p>`
          : emptyState('check', 'All caught up', 'Nothing is waiting for approval.')}
      </section>
      ${activityFeed(feed.items)}
      </div>`);
    countUp(root);
    last = { pending: o.pending.patients, patients: sum.approved_patients };
  }

  // White panel in the hero: how much of today's queue has been worked through.
  function queuePanel(o) {
    const total = o.reviewedToday + o.pending.count;
    const pct = total ? Math.round((o.reviewedToday / total) * 100) : 100;
    const waitedDays = o.pending.oldest ? Math.max(0, Math.round((new Date(todayIso()) - new Date(o.pending.oldest)) / 864e5)) : 0;
    return html`<a class="hx-rank" href="#/admin/approvals" aria-label="Reviewed today: ${o.reviewedToday} of ${total}. Open approvals">
      <span class="hx-rank-label">${icon('check', 'sm')}Reviewed today</span>
      <div class="hx-rank-big">${num(o.reviewedToday)} <small>of ${num(total)}</small></div>
      <div class="hx-bar" role="progressbar" aria-label="Share of today's queue reviewed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${raw(String(pct))}%"></span></div>
      <p class="hx-next">${o.pending.count ? html`Oldest has waited <b>${waitedDays ? plural(waitedDays, 'day') : 'less than a day'}</b>` : html`<b>Queue is empty.</b> Nice work!`}</p>
      <span class="hx-rank-link">Open approvals ${icon('chevronRight', 'sm')}</span>
    </a>`;
  }

  // Live feed of the latest submissions and reviews across the team (refreshes with every live update).
  function activityFeed(items) {
    const verb = { pending: 'submitted', approved: 'got approved for', rejected: 'was rejected for' };
    const mark = { pending: 'plus', approved: 'check', rejected: 'x' };
    return html`<section class="card feed" aria-labelledby="feed-h">
      <div class="card-head" style="padding-bottom:10px"><h2 id="feed-h">Live activity</h2><span class="feed-live"><span class="hx-live" aria-hidden="true"></span>Live</span></div>
      ${items.length ? html`<ol class="feed-list">${items.map((it) => html`<li class="feed-item ${it.status}">
          <span class="feed-av">${avatar({ name: it.user_name, color: it.user_color }, 'sm')}<span class="feed-mark" aria-hidden="true">${icon(mark[it.status] || 'plus', 'sm')}</span></span>
          <div class="feed-text"><p><b>${it.user_name.split(' ')[0]}</b> ${verb[it.status] || 'updated'} <b>${it.file_name || it.measure_name}</b></p>
            <span>${plural(it.patients, 'patient')} · ${relTime(it.reviewed_at || it.created_at)}</span></div>
        </li>`)}</ol>`
      : html`<p class="feed-empty">Activity from your team will show up here as it happens.</p>`}
    </section>`;
  }

  root.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-action="period"]');
    if (p) { period = p.dataset.value; store.set('it-admin-period', period); last = {}; load(); return; }
    const ap = e.target.closest('[data-approve]');
    if (ap) {
      setBusy(ap, true, 'Approving…');
      try {
        await api('POST', '/api/records/review', { ids: [Number(ap.dataset.approve)], action: 'approve' });
        toast('success', 'Approved', 'The employee has been notified.');
        load();
      } catch (err) { setBusy(ap, false); toast('error', 'Couldn’t approve', err.message); }
    }
  }, { signal: ac.signal });
  await load();
  return { onLive: load, destroy: () => ac.abort() };
}

// =================================================================== approvals
const REASONS = ['Supporting documentation missing in the EHR.', 'Patient count doesn’t match the visit log.', 'Duplicate of an existing record.', 'Measure criteria not met.'];

export async function approvals({ root, isStale }) {
  const ac = new AbortController();
  const f = { status: 'pending', user: '', q: '', page: 1 };
  const LIMIT = 25;
  const { items: users } = await api('GET', '/api/users');
  if (isStale()) return;
  const selected = new Set();
  let data = { items: [], total: 0, totals: {} };
  let known = null;

  root.innerHTML = String(html`
    <div class="page-head"><div><h1>Approvals</h1><p>Review submitted records. Approved patients appear on the leaderboard instantly.</p></div>
      <div class="actions"><a class="btn btn-secondary" id="csv" href="#" download>${icon('download')}Export CSV</a></div></div>
    <section class="card">
      <div class="filters" role="search">
        <div class="segmented" role="tablist" aria-label="Status">
          ${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) => html`<button type="button" role="tab" data-status="${v}" aria-selected="${f.status === v}">${l}${v === 'pending' ? raw('<span class="count" data-pending-count></span>') : ''}</button>`)}
        </div>
        <div class="input-icon grow">${icon('search', 'sm')}<input class="input" type="search" name="q" placeholder="Search employee, file name or measure" aria-label="Search"></div>
        <select class="select" name="user" aria-label="Filter by employee"><option value="">All employees</option>${users.filter((u) => u.role === 'employee').map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select>
      </div>
      <div id="list"></div>
    </section>
    <div id="bulk"></div>`);

  async function load() {
    const res = await api('GET', `/api/records?${qs({ ...f, limit: LIMIT, sort: f.status === 'pending' ? 'oldest' : '' })}`);
    if (isStale()) return;
    const prev = known; data = res; known = new Set(res.items.map((r) => r.id));
    for (const id of [...selected]) if (!data.items.some((r) => r.id === id && r.status === 'pending')) selected.delete(id);
    $('#csv', root).href = `/api/records.csv?${qs({ status: f.status, user: f.user, q: f.q })}`;
    const pages = Math.max(1, Math.ceil(data.total / LIMIT));
    const pendingRows = data.items.filter((r) => r.status === 'pending');
    const list = $('#list', root);
    if (!data.items.length) {
      list.innerHTML = String(f.status === 'pending' ? emptyState('check', 'All caught up!', 'There are no records waiting for approval. New submissions appear here live.')
        : emptyState('inbox', 'No records match', 'Try changing the filters.'));
      renderBulk(); return;
    }
    const allChecked = pendingRows.length && pendingRows.every((r) => selected.has(r.id));
    list.innerHTML = String(html`<div class="table-wrap"><table class="table cards">
      <thead><tr>
        <th scope="col" class="cell-check">${pendingRows.length ? html`<input type="checkbox" data-all aria-label="Select all pending on this page" ${allChecked ? raw('checked') : ''}>` : ''}</th>
        <th scope="col">Employee</th><th scope="col">File name / measure</th><th scope="col">Date</th><th scope="col" class="r">Patients</th><th scope="col">Status</th><th scope="col" class="r">Actions</th></tr></thead>
      <tbody>${data.items.map((r) => html`<tr data-id="${r.id}" class="${selected.has(r.id) ? 'selected' : ''} ${prev && !prev.has(r.id) ? 'flash' : ''}">
        <td class="cell-check c-check">${r.status === 'pending' ? html`<input type="checkbox" data-sel="${r.id}" aria-label="Select record from ${r.user_name}" ${selected.has(r.id) ? raw('checked') : ''}>` : ''}</td>
        <td class="c-emp"><div class="person">${avatar({ name: r.user_name, color: r.user_color }, 'sm')}<div class="meta"><div class="name">${r.user_name}</div><div class="sub">${r.user_title}</div></div></div></td>
        <td class="c-measure"><div style="font-weight:600;word-break:break-word">${r.file_name || '—'}</div><div class="note">${r.measure_name}</div>${r.note ? html`<div class="note">“${r.note}”</div>` : ''}
          ${r.status === 'rejected' && r.reject_reason ? html`<div class="reason">${icon('alert', 'sm')}<span>${r.reject_reason}</span></div>` : ''}</td>
        <td class="num c-date" style="white-space:nowrap">${fmtDate(r.date, { dow: true })}<div class="note">submitted ${relTime(r.created_at)}</div></td>
        <td class="r num c-pat" style="font-weight:700" data-suffix="${r.patients === 1 ? 'patient' : 'patients'}">${num(r.patients)}</td>
        <td class="c-status">${statusBadge(r.status)}${r.reviewed_at ? html`<div class="note">${r.reviewer_name ? `${r.reviewer_name.split(' ')[0]} · ` : ''}${relTime(r.reviewed_at)}</div>` : ''}</td>
        <td class="c-act"><div class="actions">${r.status === 'pending' ? html`
          <button class="icon-btn approve" type="button" data-approve="${r.id}" aria-label="Approve record from ${r.user_name}" title="Approve">${icon('check')}</button>
          <button class="icon-btn reject" type="button" data-reject="${r.id}" aria-label="Reject record from ${r.user_name}" title="Reject">${icon('x')}</button>` : ''}</div></td>
      </tr>`)}</tbody></table></div>
      <div class="table-foot">
        <div class="totals-strip"><span><b>${num(data.total)}</b> records</span><span><b>${num(data.totals.patients)}</b> patients</span></div>
        <div class="pager"><span>Page ${f.page} of ${pages}</span>
          <button class="icon-btn bordered" type="button" data-page="-1" aria-label="Previous page" ${f.page <= 1 ? raw('disabled') : ''}>${icon('chevronLeft', 'sm')}</button>
          <button class="icon-btn bordered" type="button" data-page="1" aria-label="Next page" ${f.page >= pages ? raw('disabled') : ''}>${icon('chevronRight', 'sm')}</button></div>
      </div>`);
    renderBulk();
  }

  function renderBulk() {
    const box = $('#bulk', root);
    const rows = data.items.filter((r) => selected.has(r.id));
    if (!rows.length) { box.innerHTML = ''; return; }
    const patients = rows.reduce((a, r) => a + r.patients, 0);
    box.innerHTML = String(html`<div class="bulk-bar" role="region" aria-label="Bulk actions" style="margin-top:16px">
      <span class="info"><b>${rows.length}</b> selected · <b>${num(patients)}</b> patients</span>
      <button class="btn btn-ghost btn-sm" type="button" data-clear>Clear</button>
      <button class="btn btn-danger btn-sm" type="button" data-bulk="reject">${icon('x', 'sm')}Reject</button>
      <button class="btn btn-success btn-sm" type="button" data-bulk="approve">${icon('check', 'sm')}Approve ${rows.length}</button>
    </div>`);
  }

  async function review(ids, action, reason) {
    try {
      const res = await api('POST', '/api/records/review', { ids, action, reason });
      ids.forEach((id) => selected.delete(id));
      toast(action === 'approve' ? 'success' : 'warn', `${plural(res.updated, 'record')} ${action === 'approve' ? 'approved' : 'rejected'}`,
        res.skipped ? `${plural(res.skipped, 'record was', 'records were')} already reviewed by someone else.` : 'The employee has been notified.');
      await load();
      return true;
    } catch (err) { toast('error', 'Review failed', err.message); return false; }
  }

  function askReject(ids) {
    const rows = data.items.filter((r) => ids.includes(r.id));
    modal({
      title: rows.length > 1 ? `Reject ${rows.length} records?` : 'Reject this record?',
      desc: rows.length > 1 ? `${num(rows.reduce((a, r) => a + r.patients, 0))} patients from ${new Set(rows.map((r) => r.user_name)).size} employee(s).`
        : `${rows[0].user_name} · ${rows[0].file_name ? `${rows[0].file_name} · ` : ''}${rows[0].measure_name} · ${plural(rows[0].patients, 'patient')} on ${fmtDate(rows[0].date)}`,
      body: html`<form id="rej-form" class="stack" novalidate>
        <div class="field"><label for="rej-reason">Reason shown to the employee</label>
          <textarea class="textarea" id="rej-reason" name="reason" maxlength="300" required autofocus placeholder="Explain what needs fixing so they can resubmit"></textarea></div>
        <div class="chips">${REASONS.map((r) => html`<button type="button" class="chip" data-reason="${r}">${r.replace(/\.$/, '')}</button>`)}</div>
      </form>`,
      foot: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-danger" type="submit" form="rej-form">Reject ${rows.length > 1 ? rows.length : ''}</button>`,
      onMount(el, close) {
        const form = el.querySelector('form');
        el.addEventListener('click', (e) => { const c = e.target.closest('[data-reason]'); if (c) { form.reason.value = c.dataset.reason; fieldError(form, null, null); form.reason.focus(); } });
        form.addEventListener('input', () => fieldError(form, null, null));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (form.reason.value.trim().length < 3) return fieldError(form, 'reason', 'Please give the employee a reason.');
          const btn = el.querySelector('[type="submit"]'); setBusy(btn, true, 'Rejecting…');
          if (await review(ids, 'reject', form.reason.value.trim())) close(); else setBusy(btn, false);
        });
      },
    });
  }

  const reload = () => { f.page = 1; selected.clear(); load(); };
  const onSearch = debounce(reload, 250);
  root.addEventListener('input', (e) => { if (e.target.name === 'q') { f.q = e.target.value.trim(); onSearch(); } }, { signal: ac.signal });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'user') { f.user = t.value; return reload(); }
    if (t.matches('[data-sel]')) { const id = Number(t.dataset.sel); t.checked ? selected.add(id) : selected.delete(id); t.closest('tr').classList.toggle('selected', t.checked); syncAll(); return renderBulk(); }
    if (t.matches('[data-all]')) {
      data.items.filter((r) => r.status === 'pending').forEach((r) => (t.checked ? selected.add(r.id) : selected.delete(r.id)));
      $$('[data-sel]', root).forEach((c) => { c.checked = t.checked; c.closest('tr').classList.toggle('selected', t.checked); });
      return renderBulk();
    }
  }, { signal: ac.signal });
  function syncAll() {
    const all = $('[data-all]', root); if (!all) return;
    const p = data.items.filter((r) => r.status === 'pending');
    all.checked = p.length > 0 && p.every((r) => selected.has(r.id));
    all.indeterminate = !all.checked && p.some((r) => selected.has(r.id));
  }
  root.addEventListener('click', async (e) => {
    const t = e.target;
    const st = t.closest('[data-status]');
    if (st) { f.status = st.dataset.status; $$('[data-status]', root).forEach((b) => b.setAttribute('aria-selected', String(b === st))); return reload(); }
    const pg = t.closest('[data-page]'); if (pg) { f.page += Number(pg.dataset.page); return load(); }
    const ap = t.closest('[data-approve]');
    if (ap) { ap.disabled = true; return review([Number(ap.dataset.approve)], 'approve'); }
    const rj = t.closest('[data-reject]'); if (rj) return askReject([Number(rj.dataset.reject)]);
    if (t.closest('[data-clear]')) { selected.clear(); $$('[data-sel]', root).forEach((c) => { c.checked = false; c.closest('tr').classList.remove('selected'); }); syncAll(); return renderBulk(); }
    const bk = t.closest('[data-bulk]');
    if (bk) {
      const ids = [...selected];
      if (bk.dataset.bulk === 'reject') return askReject(ids);
      setBusy(bk, true, 'Approving…');
      if (!(await review(ids, 'approve'))) setBusy(bk, false);
    }
  }, { signal: ac.signal });

  await load();
  syncAll();
  return { onLive: () => load().then(syncAll), destroy: () => ac.abort() };
}

// =================================================================== team
export async function team({ root, isStale }) {
  const ac = new AbortController();
  let items = [];
  async function load() {
    ({ items } = await api('GET', '/api/users'));
    if (isStale()) return;
    const emps = items.filter((u) => u.role === 'employee');
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Team</h1><p>${plural(emps.filter((u) => u.active).length, 'active employee')} · lifetime approved patients.</p></div>
        <div class="actions"><button class="btn btn-primary" type="button" data-add>${icon('userPlus')}Add employee</button></div></div>
      <section class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Name</th><th scope="col" class="hide-xs">Email</th><th scope="col">Role</th><th scope="col" class="r">Patients</th>
          <th scope="col" class="r hide-xs">Pending</th><th scope="col" class="hide-xs">Last entry</th><th scope="col" class="c">Active</th><th scope="col" class="r"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${items.map((u) => html`<tr style="${u.active ? '' : raw('opacity:.6')}">
          <td><div class="person">${avatar(u)}<div class="meta"><div class="name">${u.name}${u.id === state.user.id ? html`<span class="you-tag">You</span>` : ''}</div><div class="sub">${u.title || '—'}</div></div></div></td>
          <td class="hide-xs">${u.email}</td>
          <td><span class="badge neutral">${u.role === 'admin' ? 'Admin' : 'Employee'}</span></td>
          <td class="r num">${u.role === 'employee' ? num(u.patients) : '—'}</td>
          <td class="r num hide-xs">${u.pending ? html`<span class="badge pending">${u.pending}</span>` : '0'}</td>
          <td class="hide-xs">${u.last_entry ? fmtDate(u.last_entry) : '—'}</td>
          <td class="c"><label class="switch" title="${u.active ? 'Deactivate' : 'Activate'}"><input type="checkbox" data-toggle="${u.id}" ${u.active ? raw('checked') : ''} ${u.id === state.user.id ? raw('disabled') : ''} aria-label="${u.name} active"><span></span></label></td>
          <td><div class="actions"><button class="icon-btn" type="button" data-pw="${u.id}" aria-label="Reset password for ${u.name}" title="Reset password">${icon('key', 'sm')}</button>
            ${u.role === 'employee' ? html`<button class="icon-btn danger" type="button" data-del="${u.id}" aria-label="Delete ${u.name}" title="Delete employee">${icon('trash', 'sm')}</button>` : ''}</div></td>
        </tr>`)}</tbody></table></div></section>`);
  }

  root.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-toggle]'); if (!t) return;
    const u = items.find((x) => x.id === Number(t.dataset.toggle));
    if (!t.checked) {
      const ok = await confirmDialog({ title: `Deactivate ${u.name}?`, desc: 'They will be signed out, can’t log in and are removed from the leaderboard. Their records are kept.', confirmLabel: 'Deactivate', danger: true });
      if (!ok) { t.checked = true; return; }
    }
    try { await api('PATCH', `/api/users/${u.id}`, { active: t.checked }); toast('success', t.checked ? `${u.name} activated` : `${u.name} deactivated`); load(); }
    catch (err) { t.checked = !t.checked; toast('error', 'Update failed', err.message); }
  }, { signal: ac.signal });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) return addUser(load);
    const del = e.target.closest('[data-del]');
    if (del) {
      const u = items.find((x) => x.id === Number(del.dataset.del));
      const ok = await confirmDialog({
        title: `Delete ${u.name}?`,
        desc: `This permanently deletes their account${u.records ? ` and all ${plural(u.records, 'record')} they submitted, so they disappear from every leaderboard and the Hall of Fame` : ''}. It can’t be undone. To only block sign-in and keep their records, switch Active off instead.`,
        confirmLabel: 'Delete permanently', danger: true,
      });
      if (!ok) return;
      try { await api('DELETE', `/api/users/${u.id}`); toast('success', `${u.name} deleted`); load(); }
      catch (err) { toast('error', 'Delete failed', err.message); }
      return;
    }
    const pw = e.target.closest('[data-pw]');
    if (pw) {
      const u = items.find((x) => x.id === Number(pw.dataset.pw));
      modal({
        title: 'Reset password', desc: `Set a new temporary password for ${u.name}. Share it with them securely.`,
        body: html`<form id="pw-form" novalidate><div class="field"><label for="np">New password</label><input class="input" id="np" name="password" type="text" minlength="8" autocomplete="new-password" required><div class="hint">At least 8 characters.</div></div></form>`,
        foot: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="pw-form">Update password</button>`,
        onMount(el, close) {
          const form = el.querySelector('form');
          form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            if (form.password.value.length < 8) return fieldError(form, 'password', 'Use at least 8 characters.');
            try { await api('PATCH', `/api/users/${u.id}`, { password: form.password.value }); close(); toast('success', 'Password updated'); }
            catch (err) { fieldError(form, 'password', err.message); }
          });
        },
      });
    }
  }, { signal: ac.signal });

  await load();
  return { onLive: (evt) => { if (evt.type.startsWith('user') || evt.type.startsWith('record')) load(); }, destroy: () => ac.abort() };
}

function addUser(done) {
  modal({
    title: 'Add employee', desc: 'They can sign in right away with the temporary password you set.',
    body: html`<form id="add-user" class="stack" novalidate>
      <div class="form-row"><div class="field"><label for="u-name">Full name</label><input class="input" id="u-name" name="name" autocomplete="off" required autofocus></div>
        <div class="field"><label for="u-title">Job title</label><input class="input" id="u-title" name="title" placeholder="e.g. Care Coordinator"></div></div>
      <div class="field"><label for="u-email">Work email</label><input class="input" id="u-email" name="email" type="email" autocomplete="off" required></div>
      <div class="form-row"><div class="field"><label for="u-pw">Temporary password</label><input class="input" id="u-pw" name="password" type="text" autocomplete="new-password" minlength="8" required><div class="hint">At least 8 characters.</div></div>
        <div class="field"><label for="u-role">Role</label><select class="select" id="u-role" name="role"><option value="employee">Employee</option><option value="admin">Administrator</option></select></div></div>
    </form>`,
    foot: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="add-user">Add employee</button>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); fieldError(form, null, null);
        const btn = el.querySelector('[type="submit"]'); setBusy(btn, true);
        try {
          const body = Object.fromEntries(new FormData(form));
          const { item } = await api('POST', '/api/users', body);
          close(); toast('success', `${item.name} added`, 'They can sign in now.'); done();
        } catch (err) { setBusy(btn, false); fieldError(form, err.field, err.message); }
      });
    },
  });
}

// =================================================================== files
export async function files({ root, isStale }) {
  const ac = new AbortController();
  let items = [];
  async function load() {
    ({ items } = await api('GET', '/api/files?all=1'));
    if (isStale()) return;
    const active = items.filter((f) => f.active).length;
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Files</h1><p>${plural(active, 'file')} available to employees. They pick a file from this list when logging a record.</p></div>
        <div class="actions"><button class="btn btn-primary" type="button" data-new>${icon('plus')}New file</button></div></div>
      <section class="card">${items.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">File name</th><th scope="col" class="r hide-xs">Records</th><th scope="col" class="hide-xs">Added</th><th scope="col" class="c">Active</th><th scope="col" class="r"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${items.map((f) => html`<tr style="${f.active ? '' : raw('opacity:.6')}">
          <td><div class="person">${icon('file')}<div class="meta"><div style="font-weight:700;word-break:break-word">${f.name}</div><div class="note">${f.description || 'No description'}</div></div></div></td>
          <td class="r num hide-xs">${num(f.usage)}</td>
          <td class="hide-xs">${fmtDateTime(f.created_at)}</td>
          <td class="c"><label class="switch"><input type="checkbox" data-toggle="${f.id}" ${f.active ? raw('checked') : ''} aria-label="${f.name} available to employees"><span></span></label></td>
          <td><div class="actions"><button class="icon-btn" type="button" data-edit="${f.id}" aria-label="Edit ${f.name}">${icon('pencil', 'sm')}</button></div></td>
        </tr>`)}</tbody></table></div>`
        : emptyState('file', 'No files yet', 'Add a file so employees can start logging records against it.', html`<button class="btn btn-primary" type="button" data-new>${icon('plus')}New file</button>`)}</section>`);
  }

  root.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-toggle]'); if (!t) return;
    try { await api('PATCH', `/api/files/${t.dataset.toggle}`, { active: t.checked }); toast('success', t.checked ? 'File available to employees' : 'File hidden from employees'); load(); }
    catch (err) { t.checked = !t.checked; toast('error', 'Update failed', err.message); }
  }, { signal: ac.signal });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) return editFile(null, load);
    const ed = e.target.closest('[data-edit]');
    if (ed) editFile(items.find((f) => f.id === Number(ed.dataset.edit)), load);
  }, { signal: ac.signal });

  await load();
  return { onLive: (evt) => { if (evt.type === 'file.changed' || evt.type.startsWith('record')) load(); }, destroy: () => ac.abort() };
}

function editFile(f, done) {
  modal({
    title: f ? 'Edit file' : 'New file',
    desc: f ? 'Renaming a file doesn’t change records already logged against it.' : 'Employees will be able to pick this file when they log a record.',
    body: html`<form id="file-form" class="stack" novalidate>
      <div class="field"><label for="file-name">File name</label><input class="input" id="file-name" name="name" maxlength="120" autocomplete="off" placeholder="e.g. Clinic A – November 2026.xlsx" value="${f?.name || ''}" required autofocus></div>
      <div class="field"><label for="file-desc">Description <span class="muted" style="font-weight:500">(optional)</span></label><textarea class="textarea" id="file-desc" name="description" maxlength="300" placeholder="What’s in this file?">${f?.description || ''}</textarea></div>
    </form>`,
    foot: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="file-form">${f ? 'Save changes' : 'Add file'}</button>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      form.addEventListener('input', () => fieldError(form, null, null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); fieldError(form, null, null);
        const name = form.elements.name.value.trim();
        if (name.length < 2) return fieldError(form, 'name', 'Enter a file name (at least 2 characters).');
        const btn = el.querySelector('[type="submit"]'); setBusy(btn, true);
        try {
          await api(f ? 'PATCH' : 'POST', f ? `/api/files/${f.id}` : '/api/files', { name, description: form.elements.description.value });
          close(); toast('success', f ? 'File updated' : 'File added', f ? '' : 'Employees can pick it now.'); done();
        } catch (err) { setBusy(btn, false); fieldError(form, err.field, err.message); }
      });
    },
  });
}
