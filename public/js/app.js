// App bootstrap: session, shell, hash router and live updates (Server-Sent Events).
import { html, raw, $, $$, api, state, icon, brandMark, avatar, toast, plural, debounce, store, modal, fieldError, setBusy } from './lib.js';
import { renderLogin } from './views/login.js';
import * as employee from './views/employee.js';
import * as board from './views/leaderboard.js';
import * as admin from './views/admin.js';

const root = document.getElementById('root');

const NAV = {
  employee: [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', view: employee.dashboard },
    { path: '/log', label: 'Submit work', short: 'Submit', icon: 'plusCircle', view: employee.logRecord, cta: true },
    { path: '/history', label: 'My history', short: 'History', icon: 'history', view: employee.history },
    { path: '/leaderboard', label: 'Leaderboard', icon: 'trophy', view: board.leaderboard },
  ],
  admin: [
    { path: '/admin', label: 'Overview', icon: 'chart', view: admin.overview },
    { path: '/admin/approvals', label: 'Approvals', icon: 'approvals', view: admin.approvals, badge: true },
    { path: '/leaderboard', label: 'Leaderboard', icon: 'trophy', view: board.leaderboard },
    { path: '/admin/team', label: 'Team', icon: 'users', view: admin.team },
    { path: '/admin/files', label: 'Files', icon: 'file', view: admin.files },
  ],
};

let current = null;      // { path, instance }
let navToken = 0;
let events = null;

// ------------------------------------------------------------------ shell
function renderShell() {
  const u = state.user;
  const items = NAV[u.role];
  root.innerHTML = String(html`<div class="app">
    <header class="topbar" id="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#${items[0].path}" aria-label="Incentive Tracker home">${brandMark()}<span class="brand-name">Incentive<small>Tracker</small></span></a>
        <div class="spacer"></div>
        ${pillNav(items, 'pill-nav-top')}
        <div class="spacer"></div>
        <span class="live" id="live" title="Live updates"><span class="dot"></span><span class="live-text hide-sm">Connecting…</span></span>
        <button class="icon-btn bordered" type="button" data-action="theme" aria-label="Toggle dark mode" id="theme-btn"></button>
        <div class="user-chip">${avatar(u)}<div class="meta"><div class="name">${u.name}</div><div class="role">${u.title || (u.role === 'admin' ? 'Administrator' : 'Employee')}</div></div></div>
        <button class="icon-btn bordered" type="button" data-action="password" aria-label="Change password" title="Change password">${icon('key')}</button>
        <button class="icon-btn bordered" type="button" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button>
      </div>
    </header>
    <div class="main">
      <main class="content" id="main" tabindex="-1"></main>
    </div>
    ${pillNav(items, 'pill-nav-bottom')}
  </div>`);
  updateThemeButton();
  window.addEventListener('scroll', () => $('#topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  refreshPendingBadge();
}

// Pill navigation (ported from the BottomNavBar design): icon-only items, the current page expands to show its label.
// Rendered twice — in the header on desktop and floating at the bottom on phones — and CSS shows one of them.
function pillNav(items, where) {
  return html`<nav class="pill-nav ${where}" aria-label="Main navigation">${items.map((it) => html`<a class="pn-item" href="#${it.path}" data-path="${it.path}" title="${it.label}">
      <span class="pn-ico">${icon(it.icon)}${it.badge ? raw('<span class="pn-count" data-pending-count hidden></span>') : ''}</span>
      <span class="pn-label"><span>${where === 'pill-nav-bottom' && it.short ? it.short : it.label}</span></span>
    </a>`)}</nav>`;
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const b = $('#theme-btn'); if (!b) return;
  b.innerHTML = String(icon(dark ? 'sun' : 'moon'));
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

async function refreshPendingBadge() {
  if (state.user?.role !== 'admin') return;
  try {
    const { total } = await api('GET', '/api/records?status=pending&limit=1');
    $$('[data-pending-count]').forEach((el) => { el.textContent = total > 99 ? '99+' : String(total); el.hidden = !total; });
  } catch { /* non-critical */ }
}

// ------------------------------------------------------------------ router
function resolve() {
  const items = NAV[state.user.role];
  const path = (location.hash.replace(/^#/, '') || items[0].path).split('?')[0];
  return items.find((it) => it.path === path) || null;
}

async function navigate() {
  if (!state.user) return;
  const route = resolve();
  if (!route) { location.replace(`#${NAV[state.user.role][0].path}`); return; }
  const token = ++navToken;
  current?.instance?.destroy?.();
  $$('[data-path]').forEach((a) => (a.dataset.path === route.path ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${route.label} · Incentive Tracker`;
  const main = $('#main');
  main.innerHTML = '<div class="stack" style="margin-top:16px"><div class="skeleton" style="height:140px;border-radius:20px"></div><div class="kpis">' +
    '<div class="skeleton" style="height:120px;border-radius:16px"></div>'.repeat(4) + '</div><div class="skeleton" style="height:300px;border-radius:16px"></div></div>';
  try {
    const instance = await route.view({ root: main, isStale: () => token !== navToken });
    if (token !== navToken) { instance?.destroy?.(); return; }
    current = { path: route.path, instance };
    // gentle entrance on navigation only (live re-renders don't replay it)
    main.classList.remove('page-in'); void main.offsetWidth; main.classList.add('page-in');
    refreshPendingBadge();
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (token !== navToken) return;
    main.innerHTML = String(html`<div class="card" style="margin-top:24px"><div class="empty"><div class="ei">${icon('alert', 'lg')}</div>
      <h3>We couldn’t load this page</h3><p>${err.message}</p><button class="btn btn-primary" data-action="retry">Try again</button></div></div>`);
  }
}

// ------------------------------------------------------------------ live updates
function connectLive() {
  events?.close();
  events = new EventSource('/api/events');
  const live = () => $('#live');
  const setLive = (on, text) => { const el = live(); if (!el) return; el.classList.toggle('on', on); el.querySelector('.live-text').textContent = text; };
  events.addEventListener('hello', () => setLive(true, 'Live'));
  events.onerror = () => setLive(false, 'Reconnecting…');
  const refresh = debounce((evt) => { current?.instance?.onLive?.(evt); refreshPendingBadge(); }, 250);
  events.addEventListener('change', (e) => {
    let evt; try { evt = JSON.parse(e.data); } catch { return; }
    const el = live();
    if (el) { el.classList.add('pulse'); setLive(true, 'Updated just now'); setTimeout(() => { el.classList.remove('pulse'); setLive(true, 'Live'); }, 2500); }
    notify(evt);
    refresh(evt);
  });
}

function notify(evt) {
  const me = state.user;
  if (me.role === 'employee' && evt.type === 'record.reviewed' && evt.ownerId === me.id) {
    if (evt.status === 'approved') toast('success', `${plural(evt.count, 'record')} approved`, `${plural(evt.patients, 'patient')} now count toward the leaderboard.`, 6000);
    else toast('warn', `${plural(evt.count, 'record')} rejected`, 'Open My history to see the reason and resubmit.', 7000);
  }
  if (me.role === 'admin' && evt.type === 'record.created') {
    toast('info', 'New submission', `${evt.ownerName} logged ${plural(evt.count, 'record')} for review.`);
  }
}

// ------------------------------------------------------------------ global actions
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]'); if (!a) return;
  if (a.dataset.action === 'logout') {
    await api('POST', '/api/auth/logout').catch(() => {});
    signedOut();
  } else if (a.dataset.action === 'theme') {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('it-theme', next); } catch { /* ignore */ }
    updateThemeButton();
  } else if (a.dataset.action === 'password') changePassword();
  else if (a.dataset.action === 'retry') navigate();
});

// Password input with a show/hide eye button (styled by .pw-wrap).
function pwField(id, name, label, autocomplete, hint = '') {
  return html`<div class="field"><label for="${id}">${label}</label>
    <div class="pw-wrap"><input class="input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required>
      <button class="icon-btn" type="button" data-show-pw aria-label="Show password" aria-pressed="false">${icon('eye', 'sm')}</button></div>
    ${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
}

function changePassword() {
  modal({
    title: 'Change password', desc: 'Your other devices will be signed out. This one stays signed in.',
    body: html`<form id="my-pw-form" novalidate>
      ${pwField('pw-cur', 'current', 'Current password', 'current-password')}
      ${pwField('pw-new', 'password', 'New password', 'new-password', 'At least 8 characters.')}
      ${pwField('pw-again', 'confirm', 'Confirm new password', 'new-password')}
    </form>`,
    foot: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="my-pw-form">Change password</button>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      form.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-show-pw]'); if (!b) return;
        const input = b.previousElementSibling; const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.innerHTML = String(icon(show ? 'eyeOff' : 'eye', 'sm'));
        b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        b.setAttribute('aria-pressed', String(show));
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!form.current.value) return fieldError(form, 'current', 'Enter your current password.');
        if (form.password.value.length < 8) return fieldError(form, 'password', 'Use at least 8 characters.');
        if (form.confirm.value !== form.password.value) return fieldError(form, 'confirm', 'The two new passwords don’t match.');
        const btn = el.querySelector('.modal-foot .btn-primary');
        setBusy(btn, true);
        try {
          await api('POST', '/api/me/password', { current: form.current.value, password: form.password.value });
          close(); toast('success', 'Password changed', 'Use your new password next time you sign in.');
        } catch (err) { setBusy(btn, false); fieldError(form, err.field, err.message); }
      });
    },
  });
}

function signedIn(user) {
  state.user = user;
  store.set('it-last-email', user.email);
  renderShell();
  connectLive();
  if (!location.hash) location.replace(`#${NAV[user.role][0].path}`);
  navigate();
}

function signedOut(message) {
  state.user = null; events?.close(); events = null;
  current?.instance?.destroy?.(); current = null;
  document.title = 'Sign in · Incentive Tracker';
  renderLogin(root, { onSuccess: signedIn, message });
}

window.addEventListener('hashchange', navigate);
window.addEventListener('auth:expired', () => signedOut('Your session expired. Please sign in again.'));

(async function boot() {
  try { state.config = { ...state.config, ...(await api('GET', '/api/config')) }; } catch { /* defaults */ }
  try { const { user } = await api('GET', '/api/me'); signedIn(user); }
  catch { signedOut(); }
})();
