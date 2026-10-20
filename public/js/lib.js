// Shared UI library: templating, API client, formatting, icons, toasts, modals, charts.

// ------------------------------------------------------------------ templating (auto-escaped)
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const renderVal = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(renderVal).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += renderVal(vals[i]); });
  return new Raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ app state
export const state = { user: null, config: { currency: 'USD', backdateLimitDays: 31, maxPatients: 99999, demo: true } };

// ------------------------------------------------------------------ storage (never throws)
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ------------------------------------------------------------------ API
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Request failed (${status})`); this.status = status; this.field = body?.field; }
}
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'Can’t reach the server. Check your connection and try again.' });
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && state.user) window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError(res.status, data);
  }
  return data;
}
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

// ------------------------------------------------------------------ formatting
let moneyFmt;
export function money(cents, { compact = false } = {}) {
  const v = (cents || 0) / 100;
  if (compact && Math.abs(v) >= 10000) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.config.currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  moneyFmt ||= new Intl.NumberFormat(undefined, { style: 'currency', currency: state.config.currency });
  return moneyFmt.format(v);
}
export const num = (n) => new Intl.NumberFormat().format(n || 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (s, { year = false, dow = false } = {}) => {
  const d = parseIso(s);
  return `${dow ? `${DOW[d.getDay()]}, ` : ''}${MONTHS[d.getMonth()]} ${d.getDate()}${year ? `, ${d.getFullYear()}` : ''}`;
};
export const monthShort = (s) => MONTHS[parseIso(s).getMonth()];
export const dayNum = (s) => parseIso(s).getDate();
export const dowShort = (s) => DOW[parseIso(s).getDay()];
/** SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") -> local "Oct 15, 2:05 PM". */
export function fmtDateTime(sqlUtc) {
  if (!sqlUtc) return '—';
  const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
export function relTime(sqlUtc) {
  if (!sqlUtc) return '';
  const t = new Date(sqlUtc.replace(' ', 'T') + 'Z').getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
export const plural = (n, word, pl = `${word}s`) => `${num(n)} ${n === 1 ? word : pl}`;
export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// ------------------------------------------------------------------ dates & periods (local time)
export const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => isoOf(new Date());
export const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return isoOf(d); };
export const PERIODS = [
  { key: 'week', label: 'This week', short: 'Week' },
  { key: 'month', label: 'This month', short: 'Month' },
  { key: '30d', label: 'Last 30 days', short: '30 days' },
  { key: 'last-month', label: 'Last month', short: 'Last month' },
];
export function periodRange(key) {
  const today = todayIso(); const d = parseIso(today);
  const sameDayPrevMonth = () => {
    const lastOfPrev = new Date(d.getFullYear(), d.getMonth(), 0);
    return isoOf(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), lastOfPrev.getDate())));
  };
  let r;
  switch (key) {
    case 'week': {
      const from = addDays(today, -((d.getDay() + 6) % 7));
      r = { from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7), prev: 'same time last week' }; break;
    }
    case '30d': r = { from: addDays(today, -29), to: today, prevFrom: addDays(today, -59), prevTo: addDays(today, -30), prev: 'previous 30 days' }; break;
    case 'last-month': {
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1); const last = new Date(d.getFullYear(), d.getMonth(), 0);
      r = { from: isoOf(first), to: isoOf(last), prevFrom: isoOf(new Date(d.getFullYear(), d.getMonth() - 2, 1)), prevTo: isoOf(new Date(d.getFullYear(), d.getMonth() - 1, 0)), prev: 'the month before' }; break;
    }
    default: r = { from: `${today.slice(0, 8)}01`, to: today, prevFrom: `${sameDayPrevMonth().slice(0, 8)}01`, prevTo: sameDayPrevMonth(), prev: 'same time last month' };
  }
  r.query = { from: r.from, to: r.to, prevFrom: r.prevFrom, prevTo: r.prevTo };
  return r;
}
export function periodPicker(current, action = 'period') {
  return html`<div class="segmented" role="group" aria-label="Time period">
    ${PERIODS.map((p) => html`<button type="button" data-action="${action}" data-value="${p.key}" aria-pressed="${p.key === current}" aria-label="${p.label}"><span class="l-long">${p.label}</span><span class="l-short" aria-hidden="true">${p.short}</span></button>`)}
  </div>`;
}

// ------------------------------------------------------------------ icons (Lucide-style, inline SVG)
const ICONS = {
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  plusCircle: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  approvals: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13h6M9 17h4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  arrowUp: '<path d="m18 15-6-6-6 6"/>',
  arrowDown: '<path d="m6 9 6 6 6-6"/>',
  minus: '<path d="M5 12h14"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`);
export const brandMark = () => raw(`<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#111111"/><path d="M9 25.5l6-6 4.5 4.5L31 12.5" fill="none" stroke="#F9DC5C" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M24.5 12.5H31V19" fill="none" stroke="#F9DC5C" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

export const avatar = (u, size = '') => html`<span class="avatar ${size}" style="background:${raw(/^#[0-9a-f]{6}$/i.test(u.color) ? u.color : '#0E7490')}" aria-hidden="true">${initials(u.name || u.user_name || '?')}</span>`;
export const statusBadge = (s) => html`<span class="badge ${s}">${{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[s] || s}</span>`;
export function delta(cur, prev, label) {
  if (!prev && !cur) return html`<span class="delta flat">—</span> <span>vs ${label}</span>`;
  if (!prev) return html`<span class="delta up">${icon('trendUp', 'sm')} New</span> <span>vs ${label}</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return html`<span class="delta ${cls}">${pct > 0 ? icon('trendUp', 'sm') : pct < 0 ? icon('trendDown', 'sm') : ''}${pct > 0 ? '+' : ''}${pct}%</span> <span>vs ${label}</span>`;
}
export const emptyState = (ic, title, text, cta = '') => html`<div class="empty"><div class="ei">${icon(ic, 'lg')}</div><h3>${title}</h3><p>${text}</p>${cta}</div>`;

// ------------------------------------------------------------------ toasts
export function toast(type, title, desc = '', ms = 4500) {
  const host = document.getElementById('toasts');
  const ic = { success: 'check', error: 'alert', warn: 'clock', info: 'zap' }[type] || 'info';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = String(html`<div class="ti">${icon(ic)}</div><div class="tb"><div class="tt">${title}</div>${desc ? html`<div class="td">${desc}</div>` : ''}</div>
    <button class="icon-btn" type="button" aria-label="Dismiss notification">${icon('x', 'sm')}</button>`);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button').addEventListener('click', close);
  host.appendChild(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  setTimeout(close, ms);
}

// ------------------------------------------------------------------ modal (focus-trapped, Esc to close)
export function modal({ title, desc = '', body, foot, onMount, size }) {
  const prevFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  back.innerHTML = String(html`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}" ${size ? raw(`style="width:min(${size}px,100%)"`) : ''}>
    <div class="modal-head"><div><h2 id="${id}">${title}</h2>${desc ? html`<p>${desc}</p>` : ''}</div>
      <button class="icon-btn" type="button" data-close aria-label="Close dialog">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? html`<div class="modal-foot">${foot}</div>` : ''}</div>`);
  const close = () => {
    back.remove(); document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    prevFocus?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = $$('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])', back);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  const el = back.querySelector('.modal');
  onMount?.(el, close);
  (el.querySelector('[autofocus]') || el.querySelector('input, select, textarea, .modal-foot .btn-primary, .modal-foot .btn'))?.focus();
  return { el, close };
}

export function confirmDialog({ title, desc, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const { close } = modal({
      title, desc, body: '',
      foot: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${confirmLabel}</button>`,
      onMount(el, closeFn) {
        el.querySelector('.modal-body').remove();
        el.querySelector('[data-ok]').addEventListener('click', () => { done = true; closeFn(); resolve(true); });
        const obs = new MutationObserver(() => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
        obs.observe(document.body, { childList: true });
      },
    });
    void close;
  });
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label || 'Saving…')}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export function fieldError(form, name, message) {
  $$('[data-error-for]', form).forEach((e) => e.remove());
  $$('[aria-invalid="true"]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  if (!message) return;
  const input = name && form.querySelector(`[name="${CSS.escape(name)}"]`);
  const msg = document.createElement('div');
  msg.className = 'error'; msg.dataset.errorFor = name || '';
  msg.setAttribute('role', 'alert');
  msg.innerHTML = String(html`${icon('alert', 'sm')}<span>${message}</span>`);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    (input.closest('.field') || input.parentElement).appendChild(msg);
    input.focus();
  } else {
    const box = document.createElement('div');
    box.className = 'alert error'; box.dataset.errorFor = ''; box.setAttribute('role', 'alert');
    box.innerHTML = String(html`${icon('alert')}<span>${message}</span>`);
    form.prepend(box);
  }
}

// ------------------------------------------------------------------ number animation
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Small confetti burst in brand colours from an element (e.g. after a successful submission). Skipped for reduced motion.
export function celebrate(from) {
  if (!from || reduceMotion()) return;
  const box = from.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'confetti'; layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${box.left + box.width / 2}px`; layer.style.top = `${box.top + box.height / 2}px`;
  const colors = ['#F9DC5C', '#5FE3B0', '#111111', '#E9C21C', '#FFFFFF'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    const angle = (Math.PI * 2 * i) / 34 + Math.random() * 0.4;
    const dist = 90 + Math.random() * 120;
    p.style.setProperty('--x', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(angle) * dist - 60}px`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 80}ms`;
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}

export function countUp(root = document) {
  $$('[data-count]', root).forEach((el) => {
    const to = Number(el.dataset.count); const kind = el.dataset.kind;
    const from = Number(el.dataset.from || 0);
    const f = (v) => (kind === 'money' ? money(Math.round(v)) : num(Math.round(v)));
    if (reduceMotion() || from === to) { el.textContent = f(to); return; }
    const start = performance.now(); const dur = 700;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur); const e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
export const counter = (value, kind = 'num', prev) => html`<span data-count="${value}" data-kind="${kind}" data-from="${prev ?? 0}">${kind === 'money' ? money(value) : num(value)}</span>`;

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ------------------------------------------------------------------ charts (SVG, accessible, no dependencies)
function niceMax(v) {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Stacked daily bars: approved (solid) + pending (hatched). */
// Narrow screens get a narrower viewBox so axis text stays readable instead of scaling down.
const chartWidth = () => (window.innerWidth < 640 ? 380 : 720);
const labelStep = (n, W) => Math.ceil(n / (W < 500 ? 6 : 10));

export function barChart(series, { height = 240 } = {}) {
  const W = chartWidth(); const H = W < 500 ? 200 : height; const padL = 34; const padB = 26; const padT = 10;
  const max = niceMax(Math.max(1, ...series.map((d) => d.approved + d.pending)));
  const n = series.length; const slot = (W - padL) / n; const bw = Math.max(3, Math.min(28, slot * 0.62));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = labelStep(n, W);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily patients chart">
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="var(--chart-pending)" opacity=".35"/><rect width="2.5" height="6" fill="var(--chart-pending)"/></pattern></defs>`;
  for (const t of ticks) s += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`;
  series.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2; const x = cx - bw / 2;
    const ya = y(d.approved); const yp = y(d.approved + d.pending);
    const label = `${fmtDate(d.date, { dow: true })}: ${d.approved} approved, ${d.pending} pending patients`;
    s += `<g class="col" tabindex="0" role="img" aria-label="${esc(label)}" data-i="${i}">
      <rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${H - padT - padB}" rx="4"/>`;
    if (d.approved) s += `<rect class="bar-a" x="${x}" y="${ya}" width="${bw}" height="${Math.max(0, H - padB - ya)}" rx="${Math.min(4, bw / 3)}"/>`;
    if (d.pending) s += `<rect class="bar-p" x="${x}" y="${yp}" width="${bw}" height="${Math.max(0, ya - yp)}" rx="${Math.min(4, bw / 3)}"/>`;
    s += '</g>';
    if (i % labelEvery === 0) s += `<text class="axis-label" x="${cx}" y="${H - 6}" text-anchor="middle">${n <= 7 ? dowShort(d.date) : dayNum(d.date)}</text>`;
  });
  s += '</svg>';
  return raw(`<div class="chart" data-chart="bars">${s}<div class="chart-tip" aria-hidden="true"></div></div>`);
}

/** Smooth area line for team trends. */
export function areaChart(series, { height = 240, key = 'approved' } = {}) {
  const W = chartWidth(); const H = W < 500 ? 200 : height; const padL = 34; const padB = 26; const padT = 10;
  const max = niceMax(Math.max(1, ...series.map((d) => d[key])));
  const n = series.length; const step = n > 1 ? (W - padL - 8) / (n - 1) : 0;
  const x = (i) => padL + 4 + step * i; const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const pts = series.map((d, i) => [x(i), y(d[key])]);
  const line = pts.map((p, i) => {
    if (!i) return `M${p[0]},${p[1]}`;
    const [px, py] = pts[i - 1]; const cx = (px + p[0]) / 2;
    return `C${cx},${py} ${cx},${p[1]} ${p[0]},${p[1]}`;
  }).join(' ');
  const area = `${line} L${x(n - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const labelEvery = labelStep(n, W);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Team approved patients per day">
    `;
  for (const t of [0, max / 4, max / 2, (3 * max) / 4, max]) s += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`;
  s += `<path class="area" d="${area}"/><path class="line" d="${line}"/>`;
  series.forEach((d, i) => {
    const label = `${fmtDate(d.date, { dow: true })}: ${d.approved} approved, ${d.pending} pending patients`;
    s += `<g class="col" tabindex="0" role="img" aria-label="${esc(label)}" data-i="${i}"><rect class="hit" x="${x(i) - step / 2}" y="${padT}" width="${Math.max(step, 8)}" height="${H - padT - padB}"/>
      <circle cx="${x(i)}" cy="${y(d[key])}" r="${n > 31 ? 0 : 3}" fill="var(--surface)" stroke="var(--chart-approved)" stroke-width="2"/></g>`;
    if (i % labelEvery === 0) s += `<text class="axis-label" x="${x(i)}" y="${H - 6}" text-anchor="middle">${dayNum(d.date)} ${n > 14 && dayNum(d.date) <= labelEvery ? monthShort(d.date) : ''}</text>`;
  });
  s += '</svg>';
  return raw(`<div class="chart" data-chart="area">${s}<div class="chart-tip" aria-hidden="true"></div></div>`);
}

/** Wire hover/focus tooltips for a chart created by barChart/areaChart. */
export function bindChart(root, series) {
  const chart = root.querySelector('.chart'); if (!chart) return;
  const tip = chart.querySelector('.chart-tip'); const svg = chart.querySelector('svg');
  const show = (g) => {
    const d = series[Number(g.dataset.i)]; if (!d) return;
    tip.innerHTML = String(html`<div class="tt">${fmtDate(d.date, { dow: true })}</div>
      <div class="tl"><i style="width:10px;height:10px;border-radius:3px;background:var(--chart-approved)"></i>${num(d.approved)} approved</div>
      ${d.pending ? html`<div class="tl"><i style="width:10px;height:10px;border-radius:3px;background:var(--chart-pending)"></i>${num(d.pending)} pending</div>` : ''}`);
    const r = g.querySelector('.hit').getBoundingClientRect(); const c = chart.getBoundingClientRect();
    const left = Math.min(Math.max(r.left - c.left + r.width / 2, 70), c.width - 70);
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(r.top - c.top + 20, 40)}px`;
    tip.classList.add('show');
  };
  const hide = () => tip.classList.remove('show');
  svg.addEventListener('mouseover', (e) => { const g = e.target.closest('.col'); if (g) show(g); });
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('focusin', (e) => { const g = e.target.closest('.col'); if (g) show(g); });
  svg.addEventListener('focusout', hide);
}

/** Horizontal bars for measure breakdowns. */
export function hbars(rows) {
  if (!rows.length) return emptyState('target', 'No measures yet', 'Logged measures for this period will show up here.');
  const max = Math.max(1, ...rows.map((r) => r.approved + r.pending));
  return html`<div class="hbars">${rows.slice(0, 7).map((r) => html`<div class="hbar">
    <div class="row1"><span class="n" title="${r.name}">${r.name}</span><span class="v">${num(r.approved + r.pending)}${r.pending ? html` <span class="muted" style="font-weight:600">· ${num(r.pending)} pending</span>` : ''}</span></div>
    <div class="track" role="img" aria-label="${r.name}: ${r.approved} approved, ${r.pending} pending patients">
      <span class="a" style="width:${raw(((r.approved / max) * 100).toFixed(2))}%"></span><span class="p" style="width:${raw(((r.pending / max) * 100).toFixed(2))}%"></span>
    </div></div>`)}</div>`;
}
export const legend = () => html`<div class="legend"><span><i class="a"></i>Approved</span><span><i class="p"></i>Pending</span></div>`;
