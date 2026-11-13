import { html, $, api, state, icon, setBusy, fieldError, store } from '../lib.js';

const DEMO = [
  { label: 'Employee · Maya', email: 'maya@incentive.test' },
  { label: 'Employee · Daniel', email: 'daniel@incentive.test' },
  { label: 'Admin · Jordan', email: 'admin@incentive.test' },
];

// Both sign-in illustrations are supplied images (public/img).
export function renderLogin(root, { onSuccess, message }) {
  root.innerHTML = String(html`<div class="lg-page">
    <header class="lg-head">
      <a class="lg-brand lg-in" style="--i:0" href="#" aria-label="Incentive Tracker"><span class="lg-mark" aria-hidden="true">${icon('trendUp')}</span>Incentive Tracker</a>
      <div class="lg-head-r lg-in" style="--i:1">
        <span class="lg-pill"><span class="lg-dot" aria-hidden="true"></span>Live approvals</span>
        <button class="lg-theme" type="button" data-theme-toggle aria-label="Toggle dark mode">${icon('moon')}</button>
      </div>
    </header>
    <main class="lg-stage">
      <div class="lg-scene" aria-hidden="true"><img class="lg-photo" src="/img/office-talk.png" alt="" width="400" height="264" decoding="async"><img class="lg-photo-r" src="/img/woman-laptop.png" alt="" width="226" height="340" decoding="async"><div class="lg-ground"></div></div>
      <form class="lg-card" novalidate aria-labelledby="lg-title">
        <h1 class="lg-in" style="--i:2" id="lg-title">Agent Login</h1>
        <p class="lg-sub lg-in" style="--i:3">Hey, enter your details to sign in to your account.</p>
        ${message ? html`<div class="alert info" role="status">${icon('info')}<span>${message}</span></div>` : ''}
        <div class="field lg-in" style="--i:4"><label for="email">Email</label>
          <input class="lg-input" id="email" name="email" type="email" autocomplete="username" required placeholder="you@company.com" value="${store.get('it-last-email', '')}"></div>
        <div class="field lg-in" style="--i:5"><label for="password">Password</label>
          <div class="pw-wrap"><input class="lg-input" id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password">
            <button class="lg-hide" type="button" data-toggle-pw aria-label="Show password" aria-pressed="false">Show</button></div></div>
        <button class="lg-trouble lg-in" style="--i:6" type="button" data-trouble>Having trouble signing in?</button>
        <div class="lg-help" id="lg-help" role="status" hidden>Forgot your password? Ask your administrator to reset it from the Team page.</div>
        <button class="lg-btn lg-in" style="--i:7" type="submit"><span>Sign in</span>${icon('chevronRight', 'sm')}</button>
        ${state.config.demo ? html`<div class="lg-demo lg-in" style="--i:8">
          <div class="lg-or"><span>Or try a demo account</span></div>
          <div class="lg-chips">${DEMO.map((d) => html`<button type="button" class="lg-chip" data-demo="${d.email}">${d.label}</button>`)}</div>
          <p class="lg-note">Password for all demo accounts: <b>demo1234</b></p></div>` : ''}
      </form>
    </main>
    <footer class="lg-foot lg-in" style="--i:9">© ${new Date().getFullYear()} Incentive Tracker &nbsp;|&nbsp; Patient records, counted and reviewed</footer>
  </div>`);

  const form = $('form', root);
  const pw = $('#password', root);
  (form.email.value ? pw : form.email).focus();

  $('[data-toggle-pw]', root).addEventListener('click', (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  $('[data-trouble]', root).addEventListener('click', () => { const h = $('#lg-help', root); h.hidden = !h.hidden; });

  const themeBtn = $('[data-theme-toggle]', root);
  const syncThemeIcon = () => { themeBtn.innerHTML = String(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')); };
  syncThemeIcon();
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('it-theme', next); } catch { /* ignore */ }
    syncThemeIcon();
  });

  root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    form.email.value = b.dataset.demo; pw.value = 'demo1234';
    form.requestSubmit();
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    fieldError(form, null, null);
    if (!form.email.value.trim()) return fieldError(form, 'email', 'Enter your email.');
    if (!pw.value) return fieldError(form, 'password', 'Enter your password.');
    const btn = form.querySelector('[type="submit"]');
    setBusy(btn, true, 'Signing in…');
    try {
      const { user } = await api('POST', '/api/auth/login', { email: form.email.value.trim(), password: pw.value });
      onSuccess(user);
    } catch (err) {
      setBusy(btn, false);
      fieldError(form, null, err.message);
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    }
  });
}
