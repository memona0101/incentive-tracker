// Leaderboard: top-3 folder + full ranking by approved patients, live. Incentive amounts are deliberately not shown here.
import { html, raw, api, qs, state, store, icon, num, plural, fmtDate, periodRange, periodPicker, PERIODS, avatar, counter, countUp, emptyState } from '../lib.js';

export async function leaderboard({ root, isStale }) {
  const ac = new AbortController();
  let period = store.get('it-period', 'month');
  let last = {};
  let lastRanks = new Map();

  async function load() {
    const r = periodRange(period);
    const res = await api('GET', `/api/leaderboard?${qs(r.query)}`);
    if (isStale()) return;
    render(res, r);
  }

  function render(d, r) {
    const me = state.user;
    const mine = d.rows.find((x) => x.id === me.id);
    const top = d.rows.slice(0, 3);
    const leaderVal = Math.max(1, d.rows[0]?.patients || 1);
    const periodLabel = PERIODS.find((p) => p.key === period).label;
    // all-time approved patients: the employee's own count, or the whole team's for admins
    const allTime = d.allTime || { mine: mine?.patients || 0, team: d.totals.patients };
    const totalAll = me.role === 'employee' ? allTime.mine : allTime.team;
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Leaderboard</h1><p>${periodLabel} · ${fmtDate(r.from)} – ${fmtDate(r.to, { year: true })}. Ranked by approved patients.</p></div>
        <div class="actions">${periodPicker(period)}</div></div>

      <div class="kpis kpis-3">
        <div class="card kpi fade-in"><div class="top"><span class="label">Employees ranked</span><span class="ico ink">${icon('users')}</span></div>
          <div class="value">${counter(d.employees, 'num', last.employees)}</div><div class="foot">Active team members</div></div>
        <div class="card kpi total-kpi fade-in">
          <div class="tk-body"><span class="label">Total patients</span>
            <div class="value">${counter(totalAll, 'num', last.totalAll)}</div>
            <div class="foot">${icon('clock', 'sm')}<b>All time</b><span>Cumulative total</span></div></div>
          <span class="tk-ico" aria-hidden="true">${icon('trendUp')}</span></div>
        ${me.role === 'employee' ? html`<div class="card kpi fade-in"><div class="top"><span class="label">Your position</span><span class="ico gold">${icon('award')}</span></div>
          <div class="value">${mine ? html`#${mine.rank} <small>of ${d.employees}</small>` : '—'}</div>
          <div class="foot">${mine && mine.rank > 1 ? `${gap(d, mine)} to reach #${mine.rank - 1}` : mine ? 'You’re leading the team!' : ''}</div></div>`
        : html`<div class="card kpi fade-in"><div class="top"><span class="label">Current leader</span><span class="ico gold">${icon('award')}</span></div>
          <div class="value" style="font-size:22px">${d.rows[0]?.patients ? d.rows[0].name : '—'}</div><div class="foot">${d.rows[0]?.patients ? plural(d.rows[0].patients, 'patient') : 'No approved records yet'}</div></div>`}
      </div>

      ${d.rows.length ? html`
      ${topFolder(top, me, periodLabel)}

      <div class="cols-2-1 lb-cols">
      <section class="card" aria-labelledby="rank-h">
        <div class="card-head" style="padding-bottom:12px"><div><h2 id="rank-h">Full ranking</h2><div class="sub">Ties share a rank.</div></div></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Rank</th><th scope="col">Employee</th><th scope="col" class="r">Patients</th>
            <th scope="col" class="r hide-xs">Active days</th><th scope="col" class="hide-xs">vs. leader</th></tr></thead>
          <tbody>${d.rows.map((row) => {
            const changed = lastRanks.size && lastRanks.get(row.id) !== undefined && lastRanks.get(row.id) !== row.rank;
            const pct = (row.patients / leaderVal) * 100;
            return html`<tr class="${row.id === me.id ? 'me' : ''} ${changed ? 'flash' : ''}">
              <td><div class="rank-cell"><span class="rank-num ${row.rank <= 3 ? `r${row.rank}` : ''}">${row.rank}</span></div></td>
              <td><div class="person">${avatar(row)}<div class="meta"><div class="name">${row.name}${row.id === me.id ? html`<span class="you-tag">You</span>` : ''}</div><div class="sub">${row.title}</div></div></div></td>
              <td class="r num" style="font-weight:800">${num(row.patients)}</td>
              <td class="r num hide-xs">${num(row.active_days)}</td>
              <td class="hide-xs"><div class="share"><div class="track"><div class="fill" style="width:${raw(pct.toFixed(1))}%"></div></div>
                <span class="num muted" style="font-size:12.5px;width:40px;text-align:right">${Math.round(pct)}%</span></div></td>
            </tr>`;
          })}</tbody></table></div>
      </section>
      ${hallOfFame(d.hallOfFame || [], me)}
      </div>` : html`<section class="card" style="margin-top:16px">${emptyState('trophy', 'No rankings yet', 'Once records are approved, the team leaderboard appears here.')}</section>`}`);
    countUp(root);
    last = { employees: d.employees, totalAll };
    lastRanks = new Map(d.rows.map((x) => [x.id, x.rank]));
  }

  // One 3D folder (ported from the AnimatedFolder design) holding the top 3. Hover, focus or tap opens it and
  // the three leaders pop out as cards: #1 raised in the middle, #2 left, #3 right. The cards are display-only.
  function topFolder(top, me, periodLabel) {
    return html`<section class="card top-folder folder fade-in" data-folder tabindex="0" aria-labelledby="tf-title" aria-describedby="tf-hint">
      <div class="folder-stage">
        <div class="f-back" aria-hidden="true"></div>
        <div class="f-tab" aria-hidden="true"></div>
        <div class="f-cards" role="list">${top.map((row, i) => html`<div class="f-card pos${i + 1}" role="listitem" aria-label="Rank ${row.rank}: ${row.name}">
            <span class="f-rank" aria-hidden="true">${row.rank}</span>
            ${avatar(row)}
            <span class="f-name">${row.name}</span>
            ${row.id === me.id ? html`<span class="you-tag">You</span>` : ''}
          </div>`)}</div>
        <div class="f-front" aria-hidden="true">${icon('trophy', 'lg')}<span>Top ${top.length}</span></div>
        <div class="f-shine" aria-hidden="true"></div>
      </div>
      <h2 class="f-title" id="tf-title">Top ${top.length} performers</h2>
      <p class="f-sub">${periodLabel} · ranked by approved patients</p>
      <p class="f-hint" id="tf-hint">Hover or tap the folder to reveal</p>
    </section>`;
  }

  // Hall of Fame: the #1 employee of each previous calendar month (newest first). Independent of the period picker.
  function hallOfFame(list, me) {
    const t = new Date(); const pm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const prevMonth = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`;
    return html`<aside class="card hof fade-in" aria-labelledby="hof-h">
      <div class="hof-head"><span class="hof-ico" aria-hidden="true">${icon('trophy')}</span><h2 id="hof-h">Hall of Fame</h2></div>
      <p class="hof-sub">Top performers of previous months.</p>
      ${list.length ? html`<ol class="hof-list">${list.map((h) => html`<li class="hof-item ${h.month === prevMonth ? 'latest' : ''} ${h.id === me.id ? 'me' : ''}">
          ${avatar(h)}
          <div class="meta">
            <div class="name">${h.name}${h.id === me.id ? html`<span class="you-tag">You</span>` : ''}</div>
            <div class="when">${monthLabel(h.month)}</div>
            <div class="pts">${plural(h.patients, 'patient')}</div>
          </div>
          ${h.month === prevMonth ? html`<span class="hof-badge">Last month</span>` : ''}
        </li>`)}</ol>`
      : html`<p class="hof-empty">Winners appear here once a full month of approved records is complete.</p>`}
    </aside>`;
  }

  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function gap(d, mine) {
    const above = d.rows.filter((x) => x.rank < mine.rank).pop();
    return plural(above.patients - mine.patients + 1, 'patient');
  }

  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-action="period"]');
    if (p) { period = p.dataset.value; store.set('it-period', period); last = {}; lastRanks = new Map(); load(); return; }
    // tap to open/close on touch screens (hover covers mouse users)
    const folder = e.target.closest('[data-folder]');
    if (folder) folder.classList.toggle('is-open');
  }, { signal: ac.signal });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') root.querySelectorAll('.folder.is-open').forEach((f) => f.classList.remove('is-open'));
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-folder]')) { e.preventDefault(); e.target.classList.toggle('is-open'); }
  }, { signal: ac.signal });

  await load();
  return { onLive: load, destroy: () => ac.abort() };
}
