/* NEW MERCIES — Phase 1 app */
(() => {
'use strict';

// ---------- Configuration ------------------------------------------------
const CONFIG = {
  url: 'https://uxozxcbnlljxktkvsprd.supabase.co',
  key: 'sb_publishable_QKXJQroZrK6B-Iv5efNQwQ_PeuKOR_l',
  emailDomain: 'members.newmercies.app', // must match the "account" function
  tz: 'America/New_York',
  pinLength: 6,
  relockAfterMs: 60 * 1000,
  maxPinTries: 5,
};

const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nm-auth' },
});

const $app = document.getElementById('app');
const S = {
  session: null, me: null, members: [], memberMap: {}, tab: 'today',
  todayCheckin: null, editingCheckin: false, unlocked: false, hiddenAt: 0,
  shares: [], reacts: [], prayers: [], acks: [], modView: false,
};
const TABS = ['today', 'group', 'shares', 'prayer', 'study', 'me'];
const ACT = {}; // click handlers, keyed by data-act

// ---------- Small helpers ------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const todayNY = () => ymd(new Date());
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const initial = (h) => esc((h || '?').trim().charAt(0).toUpperCase());
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const errMsg = (e) => (e && (e.message || e.error_description || e.error)) || 'Something went wrong. Please try again.';

function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return { el: bg.firstElementChild, close: () => bg.remove() };
}
const closeModals = () => document.querySelectorAll('.modal-bg').forEach((m) => m.remove());

function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${text}</p>
      <div class="row" style="margin-top:16px">
        <button class="btn ghost block" data-x="no">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'} block" data-x="yes">${esc(okLabel)}</button>
      </div>`);
    m.el.querySelector('[data-x=no]').onclick = () => { m.close(); resolve(false); };
    m.el.querySelector('[data-x=yes]').onclick = () => { m.close(); resolve(true); };
  });
}

async function busy(btn, fn) {
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Please wait…'; }
  try { return await fn(); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

// The handle is turned into a private login address that never contains the name itself
async function handleToEmail(handle) {
  const norm = handle.trim().toLowerCase().replace(/\s+/g, ' ');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nm:' + norm));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `u${hex.slice(0, 32)}@${CONFIG.emailDomain}`;
}

async function callFn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const headers = { 'Content-Type': 'application/json', apikey: CONFIG.key };
  if (session) headers.Authorization = 'Bearer ' + session.access_token;
  const res = await fetch(`${CONFIG.url}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Request failed. Please try again.');
  return j;
}

function verseOfDay() {
  const list = window.NM_VERSES || [['Lamentations 3:23', 'They are new every morning: great is thy faithfulness.']];
  const idx = Math.floor(Date.parse(todayNY() + 'T12:00:00Z') / 86400000) % list.length;
  return list[idx];
}

// ---------- Chips --------------------------------------------------------
const CHIPS = [
  [0, 'Blue chip', '#7FB2E5'], [30, '30 days', '#C9CED8'], [60, '60 days', '#E89A8A'],
  [90, '90 days', '#9FD08A'], [180, '6 months', '#F6B26B'], [270, '9 months', '#B5A4E0'],
  [365, '1 year', '#F1C232'], [545, '18 months', '#8CC5CE'], [730, '2 years', '#E9A94F'],
];
function chipFor(days) {
  if (days >= 1095) return { label: `${Math.floor(days / 365)} years`, color: '#E9A94F' };
  let c = CHIPS[0]; for (const x of CHIPS) if (days >= x[0]) c = x;
  return { label: c[1], color: c[2] };
}
function nextChip(days) {
  for (const x of CHIPS) if (x[0] > days) return { label: x[1], in: x[0] - days };
  const y = Math.floor(days / 365) + 1;
  return { label: `${y} years`, in: y * 365 - days };
}
const daysFor = (m) => Math.max(0, daysBetween(m.start_date, todayNY()));
const daysLabel = (d) => d === 0 ? 'Day one' : d === 1 ? '1 day' : `${d} days`;

// ---------- PIN (stored only on this device, as a salted hash) -----------
const PIN_KEY = 'nm-pin', FAIL_KEY = 'nm-pin-fails';
const b64e = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pinHash(pin, saltB64) {
  const salt = saltB64 ? b64d(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 200000 }, key, 256);
  return { salt: b64e(salt), hash: b64e(new Uint8Array(bits)) };
}
async function savePin(pin) { localStorage.setItem(PIN_KEY, JSON.stringify(await pinHash(pin))); localStorage.removeItem(FAIL_KEY); }
async function checkPin(pin) {
  const stored = JSON.parse(localStorage.getItem(PIN_KEY) || 'null');
  if (!stored) return false;
  return (await pinHash(pin, stored.salt)).hash === stored.hash;
}

function keypad(onDone, title, subtitle = '', showForgot = false) {
  let pin = '';
  $app.innerHTML = `<div class="screen plain center">
    <div class="auth-hero" style="padding-bottom:0"><img src="icon-192.png" alt=""><h1>${esc(title)}</h1>
    <p class="muted" id="kp-sub">${subtitle}</p></div>
    <div class="pin-dots" id="kp-dots">${'<span></span>'.repeat(CONFIG.pinLength)}</div>
    <div class="keypad" id="kp">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      ${showForgot ? '<button class="text" data-k="forgot">Forgot?</button>' : '<span></span>'}<button data-k="0">0</button><button class="text" data-k="del">Delete</button>
    </div><p class="error" id="kp-err"></p></div>`;
  const dots = () => [...document.querySelectorAll('#kp-dots span')].forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const api = {
    reset(msg) { pin = ''; dots(); document.getElementById('kp-err').textContent = msg || ''; },
    setSub(t) { document.getElementById('kp-sub').innerHTML = t; },
  };
  document.getElementById('kp').onclick = async (e) => {
    const k = e.target.closest('button')?.dataset.k; if (!k) return;
    if (k === 'forgot') return ACT.forgotPin();
    if (k === 'del') { pin = pin.slice(0, -1); return dots(); }
    if (pin.length >= CONFIG.pinLength) return;
    pin += k; dots();
    if (pin.length === CONFIG.pinLength) { const p = pin; await onDone(p, api); }
  };
  return api;
}

function renderSetPin() {
  let first = null;
  keypad(async (pin, api) => {
    if (!first) { first = pin; api.reset(); api.setSub('Enter it once more to confirm.'); return; }
    if (pin !== first) { first = null; api.setSub(`Choose a ${CONFIG.pinLength}-digit PIN.`); return api.reset("Those didn't match. Let's try again."); }
    await savePin(pin);
    openVault(pin);
    S.unlocked = true;
    enterApp();
  }, 'Set your PIN', `Choose a ${CONFIG.pinLength}-digit PIN. You'll enter it every time you open New Mercies on this phone.`);
}

function renderLock() {
  S.unlocked = false; closeVault();
  keypad(async (pin, api) => {
    if (await checkPin(pin)) { localStorage.removeItem(FAIL_KEY); openVault(pin); S.unlocked = true; return enterApp(); }
    const fails = Number(localStorage.getItem(FAIL_KEY) || 0) + 1;
    localStorage.setItem(FAIL_KEY, String(fails));
    if (fails >= CONFIG.maxPinTries) { await signOut(); return renderAuth('signin', 'Too many wrong PIN attempts. Please sign in again with your name and password.'); }
    api.reset(`Wrong PIN. ${CONFIG.maxPinTries - fails} ${CONFIG.maxPinTries - fails === 1 ? 'try' : 'tries'} left.`);
  }, 'Welcome back', 'Enter your PIN', true);
}

ACT.forgotPin = async () => {
  if (!(await confirmBox('Forgot your PIN?', "You'll sign in again with your name and password, then choose a new PIN.", 'Sign in again'))) return;
  await signOut();
  renderAuth('signin');
};

// ---------- Sign in / Join -----------------------------------------------
function renderAuth(mode = 'signin', notice = '') {
  S.unlocked = false;
  const today = todayNY();
  $app.innerHTML = `<div class="screen plain">
    <div class="auth-hero"><img src="icon-192.png" alt=""><h1>New Mercies</h1>
      <p class="muted serif">"They are new every morning."</p></div>
    ${notice ? `<div class="card small">${esc(notice)}</div>` : ''}
    <div class="tabs"><button data-act="authTab" data-mode="signin" class="${mode === 'signin' ? 'on' : ''}">Sign in</button>
      <button data-act="authTab" data-mode="join" class="${mode === 'join' ? 'on' : ''}">Join with invite</button></div>
    ${mode === 'signin' ? `
      <div class="card stack">
        <div><label for="a-name">Your group name</label><input id="a-name" type="text" autocomplete="username" autocapitalize="off"></div>
        <div><label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="current-password"></div>
        <button class="btn primary block" data-act="signIn">Sign in</button>
        <p class="error" id="a-err"></p>
        <p class="hint">Forgot your password? Ask your moderator to reset it.</p>
      </div>
      <p class="center small"><a href="#" data-act="openBackupNoAccount" style="color:var(--muted)">Have a Step 4 backup? Open it</a></p>` : `
      <div class="card stack">
        <div><label for="j-code">Invite code</label><input id="j-code" type="text" autocapitalize="characters" placeholder="NM-XXXXXX"></div>
        <div><label for="j-name">Choose a group name</label><input id="j-name" type="text" maxlength="24" autocapitalize="words" autocomplete="off">
          <p class="hint">This is how the group will know you in the app. Don't use your full name.</p></div>
        <div><label for="j-pass">Password</label><input id="j-pass" type="password" autocomplete="new-password">
          <p class="hint">At least 8 characters. You'll use this when signing in on a new phone.</p></div>
        <div><label for="j-pass2">Confirm password</label><input id="j-pass2" type="password" autocomplete="new-password"></div>
        <div><label for="j-start">Your start date</label><input id="j-start" type="date" max="${today}" value="${today}">
          <p class="hint">The day this season of freedom began. It's used for your chip milestones.</p></div>
        <button class="btn primary block" data-act="join">Join the group</button>
        <p class="error" id="a-err"></p>
        <p class="hint">No email or phone number is ever collected.</p>
      </div>`}
  </div>`;
}
ACT.authTab = (el) => renderAuth(el.dataset.mode);

async function doSignIn(handle, password) {
  const email = await handleToEmail(handle);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(/invalid/i.test(error.message) ? "That name and password didn't match." : error.message);
  S.session = data.session;
}

ACT.signIn = (btn) => busy(btn, async () => {
  const err = document.getElementById('a-err'); err.textContent = '';
  const name = document.getElementById('a-name').value.trim();
  const pass = document.getElementById('a-pass').value;
  if (!name || !pass) { err.textContent = 'Enter your group name and password.'; return; }
  try { await doSignIn(name, pass); renderSetPin(); } catch (e) { err.textContent = errMsg(e); }
});

ACT.join = (btn) => busy(btn, async () => {
  const err = document.getElementById('a-err'); err.textContent = '';
  const code = document.getElementById('j-code').value.trim();
  const handle = document.getElementById('j-name').value.trim().replace(/\s+/g, ' ');
  const pass = document.getElementById('j-pass').value;
  const pass2 = document.getElementById('j-pass2').value;
  const start = document.getElementById('j-start').value;
  if (!code || !handle || !pass) { err.textContent = 'Please fill in every field.'; return; }
  if (pass.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
  if (pass !== pass2) { err.textContent = "Passwords don't match."; return; }
  if (!start || start > todayNY()) { err.textContent = 'Please choose a start date (today or earlier).'; return; }
  try {
    await callFn('account', { action: 'signup', code, handle, password: pass, start_date: start });
    await doSignIn(handle, pass);
    renderSetPin();
  } catch (e) { err.textContent = errMsg(e); }
});

function renderForcePassword() {
  $app.innerHTML = `<div class="screen plain"><div class="auth-hero"><img src="icon-192.png" alt="">
    <h1>Choose a new password</h1><p class="muted">Your moderator reset your password. Pick a new one only you know.</p></div>
    <div class="card stack">
      <div><label for="fp1">New password</label><input id="fp1" type="password" autocomplete="new-password"></div>
      <div><label for="fp2">Confirm new password</label><input id="fp2" type="password" autocomplete="new-password"></div>
      <button class="btn primary block" data-act="forcePassword">Save password</button><p class="error" id="fp-err"></p>
    </div></div>`;
}
ACT.forcePassword = (btn) => busy(btn, async () => {
  const p1 = document.getElementById('fp1').value, p2 = document.getElementById('fp2').value;
  const err = document.getElementById('fp-err');
  if (p1.length < 8) { err.textContent = 'At least 8 characters, please.'; return; }
  if (p1 !== p2) { err.textContent = "Passwords don't match."; return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { err.textContent = errMsg(error); return; }
  await sb.rpc('clear_must_change');
  toast('Password updated.');
  enterApp();
});

async function signOut() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) { await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch (_) { /* ignore */ }
  await sb.auth.signOut().catch(() => {});
  localStorage.removeItem(PIN_KEY); localStorage.removeItem(FAIL_KEY);
  S.session = null; S.me = null; S.unlocked = false; S.todayCheckin = null;
}

// ---------- App shell ----------------------------------------------------
async function loadMe() {
  const { data, error } = await sb.from('members').select('*').eq('id', S.session.user.id).maybeSingle();
  if (error) throw error;
  S.me = data;
}
async function loadMembers() {
  const { data, error } = await sb.from('members').select('id,handle,role,start_date,current_step,joined_at').order('handle');
  if (error) throw error;
  S.members = data || [];
  S.memberMap = Object.fromEntries(S.members.map((m) => [m.id, m]));
}
async function loadTodayCheckin() {
  const { data } = await sb.from('checkins').select('*').eq('member_id', S.me.id).eq('day', todayNY()).maybeSingle();
  S.todayCheckin = data || null;
}
async function loadLastDays() {
  const { data, error } = await sb.rpc('group_last_checkins');
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.o_member_id, r.o_last_day]));
}
const handleOf = (id) => S.memberMap[id]?.handle || 'Former member';

async function enterApp() {
  $app.innerHTML = '<div class="spinner"></div>';
  try {
    const { data: { session } } = await sb.auth.getSession();
    S.session = session;
    if (!session) return renderAuth('signin');
    await loadMe();
    if (!S.me) { await signOut(); return renderAuth('signin', 'This account is no longer part of the group.'); }
    if (S.me.must_change_password) return renderForcePassword();
    await Promise.all([loadTodayCheckin(), loadMembers()]);
  } catch (e) {
    $app.innerHTML = `<div class="screen plain"><div class="card"><h2>Can't connect</h2><p class="muted">${esc(errMsg(e))}</p>
      <button class="btn primary" data-act="retry">Try again</button></div></div>`;
    return;
  }
  const want = (location.hash || '').slice(1);
  go(S.todayCheckin && TABS.includes(want) ? want : 'today');
}
ACT.retry = () => enterApp();

const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 17h18M7 17a5 5 0 0 1 10 0M12 4v3M5 9l1.5 1.5M19 9l-1.5 1.5M12 21v-1"/></svg>',
  group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5M15 14.5c3 0 6 1.3 6 4.5"/></svg>',
  shares: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  prayer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  study: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 5.5c3-1.2 6-1 9 1 3-2 6-2.2 9-1V19c-3-1-6-.8-9 1-3-1.8-6-2-9-1z"/><path d="M12 6.5V20"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
};
const LABELS = { today: 'Today', group: 'Group', shares: 'Shares', prayer: 'Prayer', study: 'Study', me: 'Me' };

function go(tab) {
  if (tab !== 'today' && !S.todayCheckin) { toast("Check in first. It only takes a moment."); tab = 'today'; }
  if (tab !== 'me') S.modView = false;
  if (tab !== 'study') S.studySub = null;
  S.tab = tab;
  history.replaceState(null, '', '#' + tab);
  $app.innerHTML = `<div class="screen" id="view"><div class="spinner"></div></div>
    <nav class="bottom"><div class="inner">${TABS.map((t) => `<button data-act="tab" data-tab="${t}"
      class="${t === tab ? 'on' : ''} ${t !== 'today' && !S.todayCheckin ? 'locked' : ''}">${ICONS[t]}<span>${LABELS[t]}</span></button>`).join('')}
    </div></nav>
    <button class="sos-fab" data-act="sos" aria-label="Send SOS to the group">SOS</button>`;
  renderView();
}
ACT.tab = (el) => go(el.dataset.tab);

async function renderView() {
  const view = document.getElementById('view');
  if (!view) return;
  try {
    const fn = { today: viewToday, group: viewGroup, shares: viewShares, prayer: viewPrayer, study: viewStudy, me: S.modView ? viewModerator : viewMe }[S.tab];
    await fn(view);
  } catch (e) {
    view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(errMsg(e))}</p>
      <button class="btn primary" data-act="refresh">Try again</button></div>`;
  }
}
ACT.refresh = () => renderView();

const topbar = (title, extra = '') => `<div class="topbar"><h1>${esc(title)}</h1><div class="row">${extra}
  <button class="btn sm ghost" data-act="refresh" aria-label="Refresh">↻</button></div></div>`;

// ---------- Today --------------------------------------------------------
const STATUS = {
  good: { label: 'Feeling good', sub: 'Walking strong today' },
  tempted: { label: 'Feeling tempted', sub: "I'm struggling and could use support" },
  backslid: { label: 'I slipped today', sub: 'Being honest. Grace is still here' },
};
const statusPill = (s) => s ? `<span class="pill ${s}">${esc(STATUS[s].label)}</span>` : '<span class="pill none">Not checked in</span>';

async function viewToday(view) {
  const v = verseOfDay();
  const d = daysFor(S.me);
  let html = `<div class="topbar"><div class="brand"><img src="icon-192.png" alt=""><h1>New Mercies</h1></div>
    <span class="pill gold">${esc(daysLabel(d))}</span></div>
    <div class="card verse"><div class="ref">Verse of the day · ${esc(v[0])}</div><p class="serif">${esc(v[1])}</p></div>`;

  if (!S.todayCheckin || S.editingCheckin) {
    const cur = S.todayCheckin?.status || '';
    html += `<div class="card"><h2>Daily check-in</h2><p class="muted small" style="margin-top:0">How are you today, ${esc(S.me.handle)}? The group will see your answer so we can support each other.</p>
      <div class="status-grid">${Object.entries(STATUS).map(([k, s]) => `
        <button class="status-btn ${k} ${cur === k ? 'sel' : ''}" data-act="pickStatus" data-s="${k}">
          <span class="dot ${k}"></span><span><strong>${esc(s.label)}</strong><span class="muted small">${esc(s.sub)}</span></span></button>`).join('')}
      </div>
      <div style="margin-top:14px"><label for="ci-note">Anything you'd like the group to know? <span class="muted">(optional)</span></label>
        <textarea id="ci-note" maxlength="280" placeholder="A few words, if you want">${esc(S.todayCheckin?.note || '')}</textarea></div>
      <button class="btn primary block" id="ci-go" data-act="submitCheckin" ${cur ? '' : 'disabled'} style="margin-top:12px">Check in</button>
      ${S.editingCheckin ? '<button class="btn ghost block" data-act="cancelEdit" style="margin-top:8px">Cancel</button>' : ''}
    </div>`;
    view.innerHTML = html;
    view.dataset.status = cur;
    return;
  }

  const c = S.todayCheckin;
  html += `<div class="card"><div class="row between"><h2 style="margin:0">Today's check-in</h2>${statusPill(c.status)}</div>
    ${c.note ? `<p class="body" style="white-space:pre-wrap">${esc(c.note)}</p>` : ''}
    ${c.status === 'backslid' ? `<p class="muted small">Thank you for being honest. That takes courage, and the group will be there for you. Taking a blue chip is always your choice, whenever you're ready, from your Me page.</p>` : ''}
    ${c.status === 'tempted' ? `<p class="muted small">You're not alone in this. If it gets heavy, tap SOS and the group will know right away.</p>` : ''}
    <button class="btn sm ghost" data-act="editCheckin" style="margin-top:6px">Change today's check-in</button></div>`;

  const { data: today } = await sb.from('checkins').select('member_id,status').eq('day', todayNY());
  const counts = { good: 0, tempted: 0, backslid: 0 };
  (today || []).forEach((r) => counts[r.status]++);
  const notYet = Math.max(0, S.members.length - (today || []).length);
  html += `<div class="card"><h2>Today in the group</h2>
    <div class="row wrap">
      <span class="pill good">${counts.good} good</span><span class="pill tempted">${counts.tempted} tempted</span>
      <span class="pill backslid">${counts.backslid} slipped</span><span class="pill none">${notYet} not yet</span></div>
    <button class="btn block" data-act="tab" data-tab="group" style="margin-top:14px">See the group</button></div>`;
  view.innerHTML = html;
}
ACT.pickStatus = (el) => {
  const view = document.getElementById('view');
  view.dataset.status = el.dataset.s;
  view.querySelectorAll('.status-btn').forEach((b) => b.classList.toggle('sel', b === el));
  document.getElementById('ci-go').disabled = false;
};
ACT.submitCheckin = (btn) => busy(btn, async () => {
  const status = document.getElementById('view').dataset.status;
  const note = document.getElementById('ci-note').value;
  const { data, error } = await sb.rpc('check_in', { p_status: status, p_note: note });
  if (error) return toast(errMsg(error));
  S.todayCheckin = data; S.editingCheckin = false;
  toast(status === 'good' ? 'Checked in. Keep walking strong.' : 'Checked in. The group has your back.');
  go('today');
});
ACT.editCheckin = () => { S.editingCheckin = true; renderView(); };
ACT.cancelEdit = () => { S.editingCheckin = false; renderView(); };

// ---------- Group --------------------------------------------------------
function joinedDay(m) { return ymd(new Date(m.joined_at)); }

async function viewGroup(view) {
  await loadMembers();
  const today = todayNY(), from = addDays(today, -13);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [ck, sos] = await Promise.all([
    sb.from('checkins').select('member_id,day,status,note').gte('day', from),
    sb.from('sos_events').select('member_id,message,created_at').gte('created_at', since).order('created_at', { ascending: false }),
  ]);
  if (ck.error) throw ck.error;
  const byMember = {};
  (ck.data || []).forEach((r) => { (byMember[r.member_id] ||= {})[r.day] = r; });

  const lastDay = await loadLastDays();

  const sosBy = {};
  (sos.data || []).forEach((s) => { if (!sosBy[s.member_id]) sosBy[s.member_id] = s; });

  const rows = S.members.map((m) => {
    const days = byMember[m.id] || {};
    const base = lastDay[m.id] || addDays(joinedDay(m), -1);
    const missed = days[today] ? 0 : Math.max(0, daysBetween(base, today) - 1);
    const t = days[today]?.status || null;
    const rank = sosBy[m.id] ? 0 : missed >= 2 ? 1 : t === 'backslid' ? 2 : t === 'tempted' ? 3 : !t ? 4 : 5;
    return { m, days, missed, t, rank, note: days[today]?.note };
  }).sort((a, b) => a.rank - b.rank || a.m.handle.localeCompare(b.m.handle));

  let html = topbar('Group');
  Object.values(sosBy).forEach((s) => {
    html += `<div class="sos-banner"><strong>${esc(handleOf(s.member_id))}</strong> sent an SOS · ${esc(ago(s.created_at))}
      ${s.message ? `<div style="margin-top:6px">"${esc(s.message)}"</div>` : ''}
      <div class="small muted" style="margin-top:6px">Reach out to him. A call or text can make all the difference.</div></div>`;
  });
  html += `<div class="card">${rows.map((r) => {
    const chip = chipFor(daysFor(r.m));
    const week = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return `<i class="${r.days[d]?.status || ''}" title="${d}"></i>`; }).join('');
    return `<div class="member-row" data-act="profile" data-id="${r.m.id}">
      <div class="avatar">${initial(r.m.handle)}</div>
      <div class="info"><div class="name">${esc(r.m.handle)}${r.m.role === 'moderator' ? ' <span class="muted small">· moderator</span>' : ''}</div>
        <div class="row wrap" style="gap:6px;margin-top:2px">${statusPill(r.t)}
          ${r.missed >= 2 ? `<span class="pill alert">Missed ${r.missed} days</span>` : ''}
          <span class="pill gold">${esc(chip.label)}</span></div>
        ${r.note ? `<div class="small muted" style="margin-top:4px">"${esc(r.note)}"</div>` : ''}
        <div class="week">${week}</div></div></div>`;
  }).join('') || '<div class="empty">No members yet.</div>'}</div>
  <p class="hint center">Squares show the last 7 days. Green good, gold tempted, red slipped, blank no check-in.</p>`;
  view.innerHTML = html;
}

ACT.profile = async (el) => {
  const m = S.memberMap[el.dataset.id]; if (!m) return;
  const from = addDays(todayNY(), -13);
  const { data } = await sb.from('checkins').select('day,status,note').eq('member_id', m.id).gte('day', from).order('day', { ascending: false });
  const d = daysFor(m), chip = chipFor(d), next = nextChip(d);
  const byDay = Object.fromEntries((data || []).map((r) => [r.day, r]));
  const grid = Array.from({ length: 14 }, (_, i) => { const day = addDays(todayNY(), i - 13); return `<i class="${byDay[day]?.status || ''}"></i>`; }).join('');
  const notes = (data || []).filter((r) => r.note).slice(0, 5);
  const mm = modal(`<div class="center"><div class="chip-big" style="background:${chip.color}">${initial(m.handle)}</div>
      <h2>${esc(m.handle)}</h2><div class="row wrap" style="justify-content:center;gap:6px">
      <span class="pill gold">${esc(chip.label)}</span><span class="pill none">${esc(daysLabel(d))}</span><span class="pill none">Step ${m.current_step}</span></div>
      <p class="muted small">Next: ${esc(next.label)} in ${next.in} ${next.in === 1 ? 'day' : 'days'}</p></div>
    <div class="section-title">Last 14 days</div><div class="week" style="gap:6px">${grid.replace(/<i /g, '<i style="width:18px;height:18px" ')}</div>
    ${notes.length ? `<div class="section-title">Recent notes</div>${notes.map((n) => `<div class="card small"><span class="muted">${esc(fmtDate(n.day))}</span> · ${statusPill(n.status)}<div style="margin-top:6px">${esc(n.note)}</div></div>`).join('')}` : ''}
    <button class="btn block" data-x="close" style="margin-top:12px">Close</button>`);
  mm.el.querySelector('[data-x=close]').onclick = mm.close;
};

// ---------- SOS ----------------------------------------------------------
ACT.sos = () => {
  const m = modal(`<h2>Send an SOS?</h2>
    <p class="muted">Everyone in the group gets a notification that a brother needs support right now, and you'll show at the top of the Group page.</p>
    <label for="sos-msg">A few words <span class="muted">(optional, shown in the app only)</span></label>
    <input id="sos-msg" type="text" maxlength="140" placeholder="e.g. Rough night, could use a call">
    <div class="row" style="margin-top:16px"><button class="btn ghost block" data-x="no">Cancel</button>
    <button class="btn block" data-x="go" style="background:var(--sos);color:#fff;border-color:var(--sos)">Send SOS</button></div>`);
  m.el.querySelector('[data-x=no]').onclick = m.close;
  const goBtn = m.el.querySelector('[data-x=go]');
  goBtn.onclick = () => busy(goBtn, async () => {
    try {
      await callFn('notify', { action: 'sos', message: m.el.querySelector('#sos-msg').value });
      m.close(); toast("Your SOS went out. You're not alone.", 3500);
      if (S.todayCheckin) go('group');
    } catch (e) { toast(errMsg(e), 3500); }
  });
};

// ---------- Shares -------------------------------------------------------
const REACTIONS = [
  ['congrats', '🎉', 'Congrats'], ['encourage', '💪', 'Encourage'], ['laugh', '😂', 'Haha'],
  ['metoo', '🙋', 'Me too'], ['praying', '🙏', 'Praying'],
];

async function viewShares(view) {
  const { data: shares, error } = await sb.from('shares').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  S.shares = shares || [];
  const ids = S.shares.map((s) => s.id);
  S.reacts = ids.length ? ((await sb.from('share_reactions').select('*').in('share_id', ids)).data || []) : [];
  drawShares(view);
}
function drawShares(view = document.getElementById('view')) {
  const canDel = (s) => s.member_id === S.me.id || S.me.role === 'moderator';
  view.innerHTML = topbar('Small group shares') + `
    <div class="card"><label for="sh-body">Share with the group</label>
      <textarea id="sh-body" maxlength="2000" placeholder="What's going on with you? No comments here, just reactions."></textarea>
      <div class="row between" style="margin-top:10px"><span class="hint" style="margin:0">Shares disappear after 90 days.</span>
      <button class="btn primary" data-act="postShare">Share</button></div></div>
    ${S.shares.map((s) => {
      const mine = new Set(S.reacts.filter((r) => r.share_id === s.id && r.member_id === S.me.id).map((r) => r.kind));
      return `<div class="card post"><div class="meta"><div class="row"><div class="avatar" style="width:32px;height:32px">${initial(handleOf(s.member_id))}</div>
        <div><strong>${esc(handleOf(s.member_id))}</strong><div class="small muted">${esc(ago(s.created_at))}</div></div></div>
        ${canDel(s) ? `<button class="btn sm ghost" data-act="delShare" data-id="${s.id}">Delete</button>` : ''}</div>
        <div class="body">${esc(s.body)}</div>
        <div class="reactions">${REACTIONS.map(([k, e, l]) => {
          const n = S.reacts.filter((r) => r.share_id === s.id && r.kind === k).length;
          return `<button class="react ${mine.has(k) ? 'on' : ''}" data-act="react" data-id="${s.id}" data-k="${k}" title="${l}">${e} ${l}${n ? ` · ${n}` : ''}</button>`;
        }).join('')}</div></div>`;
    }).join('') || '<div class="empty">No shares yet. Be the first.</div>'}`;
}
ACT.postShare = (btn) => busy(btn, async () => {
  const body = document.getElementById('sh-body').value.trim();
  if (!body) return toast('Write something to share first.');
  const { error } = await sb.from('shares').insert({ body });
  if (error) return toast(errMsg(error));
  toast('Shared with the group.');
  renderView();
});
ACT.react = async (el) => {
  const shareId = Number(el.dataset.id), kind = el.dataset.k;
  const has = S.reacts.find((r) => r.share_id === shareId && r.member_id === S.me.id && r.kind === kind);
  if (has) {
    S.reacts = S.reacts.filter((r) => r !== has); drawShares();
    const { error } = await sb.from('share_reactions').delete().match({ share_id: shareId, member_id: S.me.id, kind });
    if (error) { toast(errMsg(error)); renderView(); }
  } else {
    S.reacts.push({ share_id: shareId, member_id: S.me.id, kind }); drawShares();
    const { error } = await sb.from('share_reactions').insert({ share_id: shareId, kind });
    if (error) { toast(errMsg(error)); renderView(); }
  }
};
ACT.delShare = async (el) => {
  if (!(await confirmBox('Delete this share?', 'It will be removed for everyone.', 'Delete', true))) return;
  const { error } = await sb.from('shares').delete().eq('id', el.dataset.id);
  if (error) return toast(errMsg(error));
  renderView();
};

// ---------- Prayer wall --------------------------------------------------
async function viewPrayer(view) {
  const { data: prayers, error } = await sb.from('prayer_requests').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  S.prayers = prayers || [];
  const ids = S.prayers.map((p) => p.id);
  S.acks = ids.length ? ((await sb.from('prayer_acks').select('*').in('request_id', ids)).data || []) : [];
  drawPrayer(view);
}
function drawPrayer(view = document.getElementById('view')) {
  view.innerHTML = topbar('Prayer wall') + `
    <div class="card"><label for="pr-body">Add a prayer request</label>
      <textarea id="pr-body" maxlength="1000" placeholder="What can the group pray for?"></textarea>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" data-act="postPrayer">Post request</button></div></div>
    ${S.prayers.map((p) => {
      const acks = S.acks.filter((a) => a.request_id === p.id);
      const iPray = acks.some((a) => a.member_id === S.me.id);
      const mine = p.member_id === S.me.id;
      return `<div class="card post ${p.answered ? 'answered' : ''}"><div class="meta"><div class="row">
          <div class="avatar" style="width:32px;height:32px">${initial(handleOf(p.member_id))}</div>
          <div><strong>${esc(handleOf(p.member_id))}</strong><div class="small muted">${esc(ago(p.created_at))}</div></div></div>
          ${p.answered ? '<span class="pill good">Answered</span>' : ''}</div>
        <div class="body">${esc(p.body)}</div>
        <div class="row wrap" style="margin-top:12px">
          ${mine ? '' : `<button class="react ${iPray ? 'on' : ''}" data-act="ack" data-id="${p.id}">🙏 ${iPray ? "I'm praying ✓" : "I'm praying"}</button>`}
          ${acks.length ? `<span class="small muted">${acks.length} praying: ${acks.map((a) => esc(handleOf(a.member_id))).join(', ')}</span>` : '<span class="small muted">Be the first to pray</span>'}
        </div>
        ${mine || S.me.role === 'moderator' ? `<div class="row" style="margin-top:10px">
          ${mine ? `<button class="btn sm" data-act="answered" data-id="${p.id}">${p.answered ? 'Mark not answered' : 'Mark answered'}</button>` : ''}
          <button class="btn sm ghost" data-act="delPrayer" data-id="${p.id}">Delete</button></div>` : ''}
      </div>`;
    }).join('') || '<div class="empty">No prayer requests yet.</div>'}`;
}
ACT.postPrayer = (btn) => busy(btn, async () => {
  const body = document.getElementById('pr-body').value.trim();
  if (!body) return toast('Write your request first.');
  const { error } = await sb.from('prayer_requests').insert({ body });
  if (error) return toast(errMsg(error));
  toast('Request posted. The group will be praying.');
  renderView();
});
ACT.ack = async (el) => {
  const id = Number(el.dataset.id);
  const has = S.acks.find((a) => a.request_id === id && a.member_id === S.me.id);
  if (has) {
    S.acks = S.acks.filter((a) => a !== has); drawPrayer();
    await sb.from('prayer_acks').delete().match({ request_id: id, member_id: S.me.id });
  } else {
    S.acks.push({ request_id: id, member_id: S.me.id }); drawPrayer();
    const { error } = await sb.from('prayer_acks').insert({ request_id: id });
    if (error) { toast(errMsg(error)); renderView(); }
  }
};
ACT.answered = async (el) => {
  const p = S.prayers.find((x) => x.id === Number(el.dataset.id)); if (!p) return;
  const { error } = await sb.from('prayer_requests').update({ answered: !p.answered }).eq('id', p.id);
  if (error) return toast(errMsg(error));
  if (!p.answered) toast('Praise God!');
  renderView();
};
ACT.delPrayer = async (el) => {
  if (!(await confirmBox('Delete this request?', 'It will be removed for everyone.', 'Delete', true))) return;
  const { error } = await sb.from('prayer_requests').delete().eq('id', el.dataset.id);
  if (error) return toast(errMsg(error));
  renderView();
};

// ---------- Me -----------------------------------------------------------
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

async function viewMe(view) {
  await loadMe();
  const d = daysFor(S.me), chip = chipFor(d), next = nextChip(d);
  const ps = await pushState();
  const pushHtml = {
    on: `<p class="small muted" style="margin-top:0">Notifications are on for this phone.</p><div class="row wrap"><button class="btn sm" data-act="testPush">Send a test</button><button class="btn sm ghost" data-act="enablePush">Re-register this phone</button></div>`,
    off: `<p class="small muted" style="margin-top:0">Turn these on so you hear about SOS alerts and get a gentle reminder to check in.</p><button class="btn primary sm" data-act="enablePush">Turn on notifications</button>`,
    denied: `<p class="small muted" style="margin-top:0">Notifications are blocked. Allow them for this app in your phone's settings, then come back here.</p>`,
    unsupported: isIOS() && !isStandalone()
      ? `<p class="small muted" style="margin-top:0">On iPhone, first add New Mercies to your Home Screen: tap the Share button in Safari, then "Add to Home Screen." Open it from there and turn notifications on here.</p>`
      : `<p class="small muted" style="margin-top:0">This browser doesn't support notifications. Try Chrome on Android or Safari on iPhone.</p>`,
  }[ps];

  view.innerHTML = topbar('Me') + `
    <div class="card center"><div class="chip-big" style="background:${chip.color}">${esc(String(d))}</div>
      <h2>${esc(S.me.handle)}</h2>
      <div class="row wrap" style="justify-content:center;gap:6px"><span class="pill gold">${esc(chip.label)}</span><span class="pill none">${esc(daysLabel(d))}</span></div>
      <p class="muted small">Since ${esc(fmtDate(S.me.start_date))} · next: ${esc(next.label)} in ${next.in} ${next.in === 1 ? 'day' : 'days'}</p>
      <button class="btn sm" data-act="blueChip">Take a blue chip</button></div>

    <div class="card"><h2>Step I'm working on</h2><p class="small muted" style="margin-top:0">The group sees this on your profile.</p>
      <div class="steps">${Array.from({ length: 12 }, (_, i) => i + 1).map((n) =>
        `<button class="${n === S.me.current_step ? 'on' : n < S.me.current_step ? 'done' : ''}" data-act="setStep" data-n="${n}">${n}</button>`).join('')}</div></div>

    <div class="card"><h2>Notifications</h2>${pushHtml}</div>

    ${!isStandalone() ? `<div class="card"><h2>Install the app</h2><p class="small muted" style="margin:0">
      <strong>Android (Chrome):</strong> tap the ⋮ menu, then "Add to Home screen" or "Install app."<br>
      <strong>iPhone (Safari):</strong> tap the Share button, then "Add to Home Screen."</p></div>` : ''}

    <div class="card stack"><h2>Security</h2>
      <button class="btn block" data-act="changePin">Change PIN</button>
      <button class="btn block" data-act="changePassword">Change password</button>
      <button class="btn block" data-act="lockNow">Lock now</button>
      <button class="btn danger block" data-act="signOutBtn">Sign out of this phone</button></div>

    ${S.me.role === 'moderator' ? `<button class="btn primary block" data-act="openMod">Moderator tools</button>` : ''}
    <p class="hint center" style="margin-top:20px">New Mercies · version 1</p>`;
}

ACT.blueChip = async () => {
  const ok = await confirmBox('Take a blue chip?',
    "This resets your day count to today. It's a fresh start, not a failure. His mercies are new every morning.", 'Take my blue chip');
  if (!ok) return;
  const { error } = await sb.rpc('take_blue_chip');
  if (error) return toast(errMsg(error));
  toast('Blue chip taken. Day one starts now.', 3200);
  renderView();
};
ACT.setStep = async (el) => {
  const n = Number(el.dataset.n);
  const { error } = await sb.rpc('set_step', { p_step: n });
  if (error) return toast(errMsg(error));
  S.me.current_step = n; toast(`Working on step ${n}.`);
  renderView();
};

function b64urlToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return b64d((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
}
ACT.enablePush = (btn) => busy(btn, async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications were not allowed.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await callFn('notify', { action: 'vapid' });
    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe(); // start clean so the phone and server always match
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToU8(publicKey) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
    toast('Notifications are on.');
    renderView();
  } catch (e) { toast(errMsg(e), 3500); }
});
ACT.testPush = (btn) => busy(btn, async () => {
  try {
    const r = await callFn('notify', { action: 'test' });
    if (r.sent) toast('Test sent. Check your notifications.');
    else if (!r.devices) toast('The server has no record of this phone. Tap "Re-register this phone."', 4500);
    else toast('Delivery failed: ' + (r.errors?.[0] || 'unknown error'), 7000);
  }
  catch (e) { toast(errMsg(e)); }
});

ACT.changePin = () => {
  let stage = 'old', first = null, oldPin = null;
  keypad(async (pin, api) => {
    if (stage === 'old') {
      if (!(await checkPin(pin))) return api.reset('That PIN is not right.');
      oldPin = pin;
      stage = 'new'; api.setSub(`Choose a new ${CONFIG.pinLength}-digit PIN.`); return api.reset();
    }
    if (stage === 'new') { first = pin; stage = 'confirm'; api.setSub('Enter it once more to confirm.'); return api.reset(); }
    if (pin !== first) { stage = 'new'; api.setSub(`Choose a new ${CONFIG.pinLength}-digit PIN.`); return api.reset("Those didn't match."); }
    await savePin(pin); await rewrapVault(oldPin, pin); toast('PIN changed.'); go('me');
  }, 'Change PIN', 'Enter your current PIN.');
};
ACT.changePassword = () => {
  const m = modal(`<h2>Change password</h2><div class="stack">
    <div><label for="cp1">New password</label><input id="cp1" type="password" autocomplete="new-password"></div>
    <div><label for="cp2">Confirm new password</label><input id="cp2" type="password" autocomplete="new-password"></div>
    <p class="error" id="cp-err"></p>
    <div class="row"><button class="btn ghost block" data-x="no">Cancel</button><button class="btn primary block" data-x="go">Save</button></div></div>`);
  m.el.querySelector('[data-x=no]').onclick = m.close;
  const goBtn = m.el.querySelector('[data-x=go]');
  goBtn.onclick = () => busy(goBtn, async () => {
    const p1 = m.el.querySelector('#cp1').value, p2 = m.el.querySelector('#cp2').value, err = m.el.querySelector('#cp-err');
    if (p1.length < 8) { err.textContent = 'At least 8 characters, please.'; return; }
    if (p1 !== p2) { err.textContent = "Passwords don't match."; return; }
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { err.textContent = errMsg(error); return; }
    m.close(); toast('Password changed.');
  });
};
ACT.lockNow = () => { closeModals(); renderLock(); };
ACT.signOutBtn = async () => {
  if (!(await confirmBox('Sign out of this phone?', "You'll need your group name and password to sign back in.", 'Sign out', true))) return;
  await signOut(); renderAuth('signin');
};

// ---------- Moderator portal --------------------------------------------
ACT.openMod = () => { S.modView = true; renderView(); };
ACT.closeMod = () => { S.modView = false; renderView(); };

async function viewModerator(view) {
  if (S.me.role !== 'moderator') { S.modView = false; return viewMe(view); }
  await loadMembers();
  const [{ data: invites }, lastDay] = await Promise.all([
    sb.from('invite_codes').select('*').order('created_at', { ascending: false }),
    loadLastDays(),
  ]);
  const active = (invites || []).filter((i) => i.uses < i.max_uses && new Date(i.expires_at) > new Date());

  view.innerHTML = `<div class="topbar"><h1>Moderator tools</h1><button class="btn sm" data-act="closeMod">Done</button></div>
    <div class="card"><h2>Invite someone</h2>
      <div class="row wrap" style="align-items:flex-end">
        <div style="flex:1;min-width:120px"><label for="iv-role">Role</label><select id="iv-role"><option value="member">Member</option><option value="moderator">Moderator</option></select></div>
        <div style="width:90px"><label for="iv-uses">Uses</label><input id="iv-uses" type="number" min="1" max="50" value="1"></div>
        <div style="width:100px"><label for="iv-days">Valid days</label><input id="iv-days" type="number" min="1" max="30" value="7"></div>
      </div>
      <button class="btn primary block" data-act="makeInvite" style="margin-top:12px">Create invite code</button>
      <p class="hint">Share the code in person or by text. Anyone with it can join until it's used up or expires.</p>
      ${active.length ? `<div class="section-title">Active codes</div>${active.map((i) => `
        <div class="row between" style="padding:8px 0;border-top:1px solid var(--line)"><div><strong style="font-family:ui-monospace,monospace">${esc(i.code)}</strong>
          <div class="small muted">${esc(i.role)} · ${i.uses}/${i.max_uses} used · expires ${esc(new Date(i.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</div></div>
          <button class="btn sm ghost" data-act="delInvite" data-code="${esc(i.code)}">Delete</button></div>`).join('')}` : ''}
    </div>
    <div class="card"><h2>Members (${S.members.length})</h2>
      ${S.members.map((m) => `<div class="member-row" data-act="modMember" data-id="${m.id}">
        <div class="avatar">${initial(m.handle)}</div><div class="info"><div class="name">${esc(m.handle)}${m.role === 'moderator' ? ' <span class="muted small">· moderator</span>' : ''}</div>
        <div class="small muted">Last check-in: ${lastDay[m.id] ? esc(fmtDate(lastDay[m.id])) : 'never'} · joined ${esc(new Date(m.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</div></div>
        <span class="muted">›</span></div>`).join('')}
    </div>`;
}

ACT.makeInvite = (btn) => busy(btn, async () => {
  const role = document.getElementById('iv-role').value;
  const uses = Number(document.getElementById('iv-uses').value) || 1;
  const days = Number(document.getElementById('iv-days').value) || 7;
  const { data, error } = await sb.rpc('create_invite', { p_max_uses: uses, p_days: days, p_role: role });
  if (error) return toast(errMsg(error));
  const m = modal(`<h2>Invite code</h2><div class="code-box">${esc(data)}</div>
    <p class="muted small">${role === 'moderator' ? '<strong>Moderator</strong> invite. ' : ''}Good for ${uses} ${uses === 1 ? 'person' : 'people'} for ${days} ${days === 1 ? 'day' : 'days'}.
    They open the app, tap "Join with invite," and enter this code.</p>
    <div class="row"><button class="btn block" data-x="copy">Copy</button><button class="btn primary block" data-x="done">Done</button></div>`);
  m.el.querySelector('[data-x=copy]').onclick = async () => { try { await navigator.clipboard.writeText(data); toast('Copied.'); } catch (_) { toast('Press and hold the code to copy it.'); } };
  m.el.querySelector('[data-x=done]').onclick = () => { m.close(); renderView(); };
});
ACT.delInvite = async (el) => {
  const { error } = await sb.from('invite_codes').delete().eq('code', el.dataset.code);
  if (error) return toast(errMsg(error));
  renderView();
};

ACT.modMember = (el) => {
  const m = S.memberMap[el.dataset.id]; if (!m) return;
  const isMe = m.id === S.me.id;
  const mm = modal(`<h2>${esc(m.handle)}</h2><p class="muted small" style="margin-top:0">${esc(m.role)} · start date ${esc(fmtDate(m.start_date))} · step ${m.current_step}</p>
    <div class="stack">
      ${isMe ? '' : '<button class="btn block" data-x="reset">Reset password</button>'}
      <button class="btn block" data-x="role">${m.role === 'moderator' ? 'Make regular member' : 'Make moderator'}</button>
      <div><label for="mm-start">Correct start date</label><div class="row"><input id="mm-start" type="date" max="${todayNY()}" value="${m.start_date}">
        <button class="btn" data-x="start">Save</button></div></div>
      ${isMe ? '' : '<button class="btn danger block" data-x="remove">Remove from group</button>'}
      <button class="btn ghost block" data-x="close">Close</button></div>`);
  const q = (x) => mm.el.querySelector(`[data-x=${x}]`);
  q('close').onclick = mm.close;
  if (!isMe) q('reset').onclick = async () => {
    if (!(await confirmBox(`Reset ${m.handle}'s password?`, "You'll get a temporary password to give him. He'll choose a new one when he signs in.", 'Reset'))) return;
    try {
      const r = await callFn('account', { action: 'reset', member_id: m.id });
      mm.close();
      const t = modal(`<h2>Temporary password</h2><div class="code-box">${esc(r.temp_password)}</div>
        <p class="muted small">Give this to ${esc(m.handle)} in person or by text. He signs in with his group name and this password, then picks a new one.</p>
        <button class="btn primary block" data-x="ok">Done</button>`);
      t.el.querySelector('[data-x=ok]').onclick = t.close;
    } catch (e) { toast(errMsg(e)); }
  };
  q('role').onclick = async () => {
    const to = m.role === 'moderator' ? 'member' : 'moderator';
    const { error } = await sb.rpc('set_role', { p_member: m.id, p_role: to });
    if (error) return toast(errMsg(error));
    mm.close(); toast(`${m.handle} is now a ${to}.`);
    if (isMe) { await loadMe(); S.modView = S.me.role === 'moderator'; }
    renderView();
  };
  q('start').onclick = async () => {
    const d = mm.el.querySelector('#mm-start').value;
    const { error } = await sb.rpc('mod_set_start', { p_member: m.id, p_date: d });
    if (error) return toast(errMsg(error));
    mm.close(); toast('Start date updated.'); renderView();
  };
  if (!isMe) q('remove').onclick = async () => {
    const typed = prompt(`This permanently removes ${m.handle} and everything he has posted. Type his group name to confirm:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== m.handle.toLowerCase()) return toast("Name didn't match. Nothing was removed.");
    try { await callFn('account', { action: 'remove', member_id: m.id }); mm.close(); toast(`${m.handle} was removed.`); renderView(); }
    catch (e) { toast(errMsg(e)); }
  };
};

// ---------- Step 4 vault: stored only on this phone, encrypted ----------
// A random key encrypts every Step 4 record. That key is itself locked with the app PIN.
const VAULT_KEY = 'nm-s4key';
let sessionPin = null;
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
async function kekFrom(secret, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 300000 }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrapRaw(raw, pin) {
  const salt = rand(16), iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kekFrom(pin, salt), raw));
  return { salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) };
}
async function unwrapRaw(rec, pin) {
  const kek = await kekFrom(pin, b64d(rec.salt));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(rec.iv) }, kek, b64d(rec.ct)));
}
const importDek = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
function openVault(pin) {
  sessionPin = pin;
  S.vaultReady = (async () => {
    S.vault = null; S.vaultLocked = false;
    const rec = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
    try {
      if (!rec) { const raw = rand(32); localStorage.setItem(VAULT_KEY, JSON.stringify(await wrapRaw(raw, pin))); S.vault = await importDek(raw); }
      else S.vault = await importDek(await unwrapRaw(rec, pin));
      navigator.storage?.persist?.().catch(() => {});
    } catch (_) { S.vaultLocked = true; }
  })();
  return S.vaultReady;
}
async function rewrapVault(oldPin, newPin) {
  const rec = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
  if (rec) {
    try { const raw = await unwrapRaw(rec, oldPin); localStorage.setItem(VAULT_KEY, JSON.stringify(await wrapRaw(raw, newPin))); }
    catch (_) { /* locked with an older PIN; leave it for the recovery screen */ }
  }
  return openVault(newPin);
}
function closeVault() { S.vault = null; sessionPin = null; S.s4 = null; }

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('nm-local', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('step4', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbReq(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction('step4', mode); const req = fn(tx.objectStore('step4'));
      tx.oncomplete = () => res(req ? req.result : undefined); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  } finally { db.close(); }
}
async function s4All() {
  const rows = (await idbReq('readonly', (st) => st.getAll())) || [];
  const out = [];
  for (const r of rows) {
    try { out.push(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, S.vault, r.ct)))); }
    catch (_) { /* unreadable record: skip */ }
  }
  return out.sort((a, b) => (a.created || '').localeCompare(b.created || ''));
}
async function s4Put(obj) {
  obj.updated = new Date().toISOString(); obj.created ||= obj.updated;
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.vault, new TextEncoder().encode(JSON.stringify(obj)));
  await idbReq('readwrite', (st) => st.put({ id: obj.id, iv, ct }));
}
const s4Del = (id) => idbReq('readwrite', (st) => st.delete(id));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Study tab ----------------------------------------------------
async function viewStudy(view) {
  if (S.studySub === 'step4') return viewStep4(view);
  const st = window.NM_STUDY || { principles: [], steps: [] };
  const item = (kind, x) => `<div class="member-row" data-act="studyItem" data-kind="${kind}" data-n="${x.n}">
    <div class="avatar">${x.n}</div><div class="info"><div class="name">${esc(x.title || (kind === 'step' ? `Step ${x.n}` : `Principle ${x.n}`))}</div>
    <div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.text ? x.text.split('\n')[0] : 'Text coming soon')}</div></div>
    ${kind === 'step' && x.n === S.me.current_step ? '<span class="pill gold">Current</span>' : '<span class="muted">›</span>'}</div>`;
  view.innerHTML = topbar('Study') + `
    <div class="card verse" data-act="openStep4" style="cursor:pointer">
      <div class="ref">Private · only on this phone</div>
      <div class="row between"><div><h2 style="margin:0;color:#fff">My Step 4 inventory</h2>
      <p style="margin:4px 0 0;color:#D8DCEA" class="small">Five-column inventory and handwritten pages, encrypted and never uploaded.</p></div>
      <span style="font-size:1.6rem;color:#FBD98A">›</span></div></div>
    ${st.principles.length ? `<div class="section-title">The principles</div><div class="card">${st.principles.map((p) => item('principle', p)).join('')}</div>` : ''}
    ${st.steps.length ? `<div class="section-title">The steps</div><div class="card">${st.steps.map((p) => item('step', p)).join('')}</div>` : ''}`;
}
ACT.studyItem = (el) => {
  const st = window.NM_STUDY || {}; const kind = el.dataset.kind; const n = Number(el.dataset.n);
  const x = (kind === 'step' ? st.steps : st.principles).find((i) => i.n === n); if (!x) return;
  const title = x.title || (kind === 'step' ? `Step ${n}` : `Principle ${n}`);
  const m = modal(`<div class="section-title" style="margin-top:0">${kind === 'step' ? 'Step' : 'Principle'} ${n}</div>
    <h2>${esc(title)}</h2>
    ${x.text ? `<p style="white-space:pre-wrap">${esc(x.text)}</p>` : '<p class="muted">Text coming soon.</p>'}
    ${(x.verses || []).map((v) => `<div class="card verse"><div class="ref">${esc(v.ref)}</div><p class="serif">${esc(v.text)}</p></div>`).join('')}
    ${kind === 'step' ? (n === S.me.current_step ? '<p class="small muted center">This is the step you\'re working on.</p>'
      : `<button class="btn block" data-x="cur">I'm working on this step</button>`) : ''}
    ${kind === 'step' && n === 4 ? '<button class="btn primary block" data-x="s4" style="margin-top:8px">Open my Step 4 inventory</button>' : ''}
    <button class="btn ghost block" data-x="close" style="margin-top:8px">Close</button>`);
  m.el.querySelector('[data-x=close]').onclick = m.close;
  const cur = m.el.querySelector('[data-x=cur]');
  if (cur) cur.onclick = async () => { const { error } = await sb.rpc('set_step', { p_step: n }); if (error) return toast(errMsg(error)); S.me.current_step = n; m.close(); toast(`Working on step ${n}.`); renderView(); };
  const s4 = m.el.querySelector('[data-x=s4]');
  if (s4) s4.onclick = () => { m.close(); ACT.openStep4(); };
};
ACT.openStep4 = () => { S.studySub = 'step4'; renderView(); };
ACT.closeStep4 = () => { S.studySub = null; renderView(); };

// ---------- Step 4 inventory ----------------------------------------------
const COLS = [
  ['person', 'Person', 'Who do I resent, fear, or feel hurt by? A person, a place, an institution, or a principle.'],
  ['cause', 'Cause', 'What happened? What did they do, or what do I believe they did?'],
  ['effect', 'Effect', 'How did it affect me? My feelings, my relationships, my choices.'],
  ['damage', 'Damage', 'What did it damage? My self-esteem, security, relationships, finances, or ambitions?'],
  ['mypart', 'My Part', 'What part did I play? Where was I selfish, dishonest, afraid, or at fault? If you were abused or harmed as a child, that was not your fault. Leave this blank.'],
];

async function viewStep4(view) {
  const head = `<div class="topbar"><button class="btn sm ghost" data-act="closeStep4">‹ Study</button>
    <button class="btn sm ghost" data-act="refresh" aria-label="Refresh">↻</button></div><h1>My Step 4 inventory</h1>`;
  await S.vaultReady;
  if (S.vaultLocked) {
    view.innerHTML = head + `<div class="card stack"><h2>Locked with an earlier PIN</h2>
      <p class="muted small" style="margin:0">The Step 4 work on this phone was saved under a previous PIN. Enter that PIN to unlock it.</p>
      <input id="old-pin" type="password" inputmode="numeric" maxlength="${CONFIG.pinLength}" placeholder="Previous PIN">
      <button class="btn primary block" data-act="s4Recover">Unlock</button>
      <p class="hint">Can't remember it? You can erase that work and start fresh. If you made a backup, you can restore it afterward.</p>
      <button class="btn danger block" data-act="s4Erase">Erase and start fresh</button></div>`;
    return;
  }
  if (!S.vault) { view.innerHTML = head + '<div class="card"><p class="muted">Lock the app and reopen it to access your Step 4 work.</p></div>'; return; }
  S.s4 = await s4All();
  const rows = S.s4.filter((r) => r.type === 'row'), pages = S.s4.filter((r) => r.type === 'page');
  const tab = S.s4tab || 'rows';
  view.innerHTML = head + `
    <div class="card small" style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:1.2rem">🔒</span>
      <span class="muted">Everything here is encrypted and stays on this phone. It is never uploaded, and no one in the group can see it.</span></div>
    <div class="tabs"><button data-act="s4Tab" data-t="rows" class="${tab === 'rows' ? 'on' : ''}">Five columns (${rows.length})</button>
      <button data-act="s4Tab" data-t="pages" class="${tab === 'pages' ? 'on' : ''}">Handwritten (${pages.length})</button></div>
    ${tab === 'rows' ? `
      <button class="btn primary block" data-act="s4Row" data-id="">+ Add a person</button>
      <div style="margin-top:14px">${rows.map((r) => `<div class="card" data-act="s4Row" data-id="${r.id}" style="cursor:pointer">
        <strong>${esc(r.person || 'Untitled')}</strong>
        <div class="small muted" style="margin-top:4px">${esc((r.cause || '').slice(0, 120)) || 'No cause written yet'}</div>
        <div class="row wrap" style="gap:4px;margin-top:8px">${COLS.slice(1).map(([k, l]) => `<span class="pill ${r[k] ? 'good' : 'none'}">${l}</span>`).join('')}</div></div>`).join('')
        || '<div class="empty">No entries yet. Add the first person, place, or thing on your list.</div>'}</div>`
    : `
      <label class="btn primary block" style="cursor:pointer">📷 Photograph a page<input id="s4-file" type="file" accept="image/*" hidden></label>
      <p class="hint center">Write by hand, then take a photo. You can keep just the photo or turn it into text you can edit, right on this phone.</p>
      <div style="margin-top:10px">${pages.map((p) => `<div class="card" data-act="s4Page" data-id="${p.id}" style="cursor:pointer;display:flex;gap:12px">
        ${p.image ? `<img src="${p.image}" alt="" style="width:64px;height:84px;object-fit:cover;border-radius:8px;flex:none">` : ''}
        <div style="min-width:0"><strong>${esc(p.title || 'Untitled page')}</strong>
        <div class="small muted" style="margin-top:4px">${p.text ? esc(p.text.slice(0, 110)) : 'Photo only'}</div></div></div>`).join('')
        || '<div class="empty">No pages yet.</div>'}</div>`}
    <div class="section-title">Keep it safe</div>
    <div class="card stack">
      <button class="btn block" data-act="s4Pdf">Save as PDF</button>
      <button class="btn block" data-act="s4Backup">Make an encrypted backup</button>
      <button class="btn block" data-act="s4Restore">Restore from a backup</button>
      <p class="hint" style="margin:0">A backup lets you move your work to a new phone or keep it if you leave the group. It's locked with a backup password you choose.</p>
    </div>`;
  const f = document.getElementById('s4-file');
  if (f) f.onchange = () => { if (f.files[0]) s4NewPhoto(f.files[0]); f.value = ''; };
}
ACT.s4Tab = (el) => { S.s4tab = el.dataset.t; renderView(); };

ACT.s4Recover = async (btn) => busy(btn, async () => {
  const old = document.getElementById('old-pin').value;
  try {
    const rec = JSON.parse(localStorage.getItem(VAULT_KEY));
    const raw = await unwrapRaw(rec, old);
    localStorage.setItem(VAULT_KEY, JSON.stringify(await wrapRaw(raw, sessionPin)));
    await openVault(sessionPin); toast('Unlocked.'); renderView();
  } catch (_) { toast("That PIN didn't unlock it."); }
});
ACT.s4Erase = async () => {
  if (!(await confirmBox('Erase Step 4 work on this phone?', 'This permanently deletes the locked Step 4 work on this phone. It cannot be undone.', 'Erase', true))) return;
  await idbReq('readwrite', (st) => st.clear()); localStorage.removeItem(VAULT_KEY);
  await openVault(sessionPin); toast('Erased. You can start fresh.'); renderView();
};

ACT.s4Row = (el) => {
  const r = S.s4.find((x) => x.id === el.dataset.id) || { id: newId(), type: 'row' };
  const isNew = !el.dataset.id;
  const m = modal(`<h2>${isNew ? 'New entry' : esc(r.person || 'Entry')}</h2><div class="stack">
    ${COLS.map(([k, l, h]) => `<div><label for="c-${k}">${l}</label>
      ${k === 'person' ? `<input id="c-${k}" type="text" maxlength="200" value="${esc(r[k] || '')}">` : `<textarea id="c-${k}" maxlength="5000">${esc(r[k] || '')}</textarea>`}
      <p class="hint">${esc(h)}</p></div>`).join('')}
    <div class="row"><button class="btn ghost block" data-x="no">Cancel</button><button class="btn primary block" data-x="save">Save</button></div>
    ${isNew ? '' : '<button class="btn danger block" data-x="del">Delete entry</button>'}</div>`);
  m.el.querySelector('[data-x=no]').onclick = m.close;
  m.el.querySelector('[data-x=save]').onclick = async () => {
    COLS.forEach(([k]) => { r[k] = m.el.querySelector('#c-' + k).value.trim(); });
    if (!r.person) return toast('Add a person, place, or thing first.');
    await s4Put(r); m.close(); toast('Saved on this phone.'); renderView();
  };
  const del = m.el.querySelector('[data-x=del]');
  if (del) del.onclick = async () => { if (!(await confirmBox('Delete this entry?', 'It will be removed from this phone.', 'Delete', true))) return; await s4Del(r.id); m.close(); renderView(); };
};

// Photos: shrink, keep on the phone, optionally read the handwriting on the phone
function fileToImage(file) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("Couldn't open that photo.")); img.src = URL.createObjectURL(file); });
}
async function shrinkPhoto(file, max = 1800) {
  const img = await fileToImage(file);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', 0.82);
}
function loadScript(src) {
  if (document.querySelector(`script[data-src="${src}"]`)) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.dataset.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
async function readHandwriting(dataUrl, onProgress) {
  await loadScript('tesseract.min.js');
  const base = new URL('.', location.href).href.replace(/\/$/, '');
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: base + '/worker.min.js', corePath: base, langPath: base, gzip: true, workerBlobURL: false,
    logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
  });
  try {
    // Light clean-up so pen on paper stands out: grayscale + contrast stretch
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < p.length; i += 4) { const v = Math.max(0, Math.min(255, ((p[i] - lo) / span) * 255)); p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0);
    const { data } = await worker.recognize(c);
    return (data.text || '').replace(/\n{3,}/g, '\n\n').trim();
  } finally { await worker.terminate(); }
}

async function s4NewPhoto(file) {
  let image;
  try { image = await shrinkPhoto(file); } catch (e) { return toast(errMsg(e)); }
  const m = modal(`<h2>New page</h2><img src="${image}" alt="" style="width:100%;border-radius:12px;max-height:46vh;object-fit:contain;background:#000">
    <div style="margin-top:12px"><label for="pg-title">Title <span class="muted">(optional)</span></label><input id="pg-title" type="text" maxlength="120" placeholder="e.g. Resentments, page 1"></div>
    <div class="stack" style="margin-top:14px">
      <button class="btn primary block" data-x="ocr">Turn into editable text</button>
      <button class="btn block" data-x="photo">Keep the photo only</button>
      <button class="btn ghost block" data-x="no">Cancel</button>
      <p class="hint" style="margin:0">Text conversion happens entirely on this phone. Neat printing works best; cursive may need more fixing.</p></div>`);
  const title = () => m.el.querySelector('#pg-title').value.trim();
  m.el.querySelector('[data-x=no]').onclick = m.close;
  m.el.querySelector('[data-x=photo]').onclick = async () => { await s4Put({ id: newId(), type: 'page', title: title(), image, text: '' }); m.close(); toast('Saved on this phone.'); renderView(); };
  m.el.querySelector('[data-x=ocr]').onclick = async () => {
    const page = { id: newId(), type: 'page', title: title(), image, text: '' };
    m.close(); await s4Ocr(page);
  };
}
async function s4Ocr(page) {
  const m = modal(`<h2>Reading your handwriting…</h2><p class="muted small">This happens on your phone and can take up to a minute. The first time is slower while it gets ready.</p>
    <div style="background:var(--surface-2);border-radius:999px;height:10px;overflow:hidden"><div id="ocr-bar" style="height:100%;width:2%;background:var(--gold);transition:width .3s"></div></div>
    <p class="center small muted" id="ocr-pct">Getting ready…</p>`);
  m.el.parentElement.onclick = null;
  try {
    page.text = await readHandwriting(page.image, (p) => {
      const bar = m.el.querySelector('#ocr-bar'); if (bar) bar.style.width = Math.max(2, p) + '%';
      const t = m.el.querySelector('#ocr-pct'); if (t) t.textContent = p + '%';
    });
    await s4Put(page); m.close();
    toast(page.text ? 'Done. Review and fix the text.' : "Couldn't find readable text. You can type it in.", 3500);
    S.s4 = await s4All(); ACT.s4Page({ dataset: { id: page.id } });
  } catch (e) { m.close(); await s4Put(page); toast('Text conversion failed, but the photo was saved. ' + errMsg(e), 5000); renderView(); }
}
ACT.s4Page = (el) => {
  const p = S.s4.find((x) => x.id === el.dataset.id); if (!p) return;
  const m = modal(`<h2>${esc(p.title || 'Page')}</h2>
    ${p.image ? `<details ${p.text ? '' : 'open'}><summary class="small muted" style="cursor:pointer;margin-bottom:8px">Show the photo</summary>
      <img src="${p.image}" alt="" style="width:100%;border-radius:12px"></details>` : ''}
    <div class="stack" style="margin-top:12px">
      <div><label for="pg-t">Title</label><input id="pg-t" type="text" maxlength="120" value="${esc(p.title || '')}"></div>
      <div><label for="pg-x">Text</label><textarea id="pg-x" style="min-height:240px">${esc(p.text || '')}</textarea>
        <p class="hint">Edit freely. Compare with the photo to fix any words the phone misread.</p></div>
      <div class="row"><button class="btn ghost block" data-x="no">Close</button><button class="btn primary block" data-x="save">Save</button></div>
      ${p.image && !p.text ? '<button class="btn block" data-x="ocr">Turn photo into text</button>' : ''}
      <button class="btn danger block" data-x="del">Delete page</button></div>`);
  m.el.querySelector('[data-x=no]').onclick = () => { m.close(); renderView(); };
  m.el.querySelector('[data-x=save]').onclick = async () => {
    p.title = m.el.querySelector('#pg-t').value.trim(); p.text = m.el.querySelector('#pg-x').value;
    await s4Put(p); m.close(); toast('Saved on this phone.'); renderView();
  };
  const o = m.el.querySelector('[data-x=ocr]'); if (o) o.onclick = () => { m.close(); s4Ocr(p); };
  m.el.querySelector('[data-x=del]').onclick = async () => { if (!(await confirmBox('Delete this page?', 'The photo and text will be removed from this phone.', 'Delete', true))) return; await s4Del(p.id); m.close(); renderView(); };
};

// PDF, backup, restore
async function deliverFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}
async function buildPdf(records, includePhotos) {
  await loadScript('jspdf.umd.min.js');
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  const M = 54, W = 612 - 2 * M, H = 792; let y = M;
  const clean = (s) => String(s || '').replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g, '');
  const write = (text, size = 11, style = 'normal', gap = 4, color = [30, 42, 71]) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(clean(text), W)) {
      if (y + size > H - M) { doc.addPage(); y = M; }
      doc.text(line, M, y + size); y += size * 1.35;
    }
    y += gap;
  };
  write('Step 4 Inventory', 22, 'bold', 2);
  write(`Prepared ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · Confidential`, 10, 'normal', 16, [106, 112, 136]);
  const rows = records.filter((r) => r.type === 'row'), pages = records.filter((r) => r.type === 'page');
  if (rows.length) {
    write('Five-column inventory', 16, 'bold', 8);
    rows.forEach((r, i) => {
      write(`${i + 1}. ${r.person || 'Untitled'}`, 13, 'bold', 2);
      COLS.slice(1).forEach(([k, l]) => { if (r[k]) { write(l, 9, 'bold', 0, [106, 112, 136]); write(r[k], 11, 'normal', 6); } });
      y += 8;
    });
  }
  if (pages.length) {
    if (rows.length) { doc.addPage(); y = M; }
    write('Handwritten pages', 16, 'bold', 8);
    for (const p of pages) {
      write(p.title || 'Untitled page', 13, 'bold', 4);
      if (p.text) write(p.text, 11, 'normal', 8);
      if (includePhotos && p.image) {
        const img = new Image(); img.src = p.image; await img.decode();
        let w = W, h = (img.naturalHeight / img.naturalWidth) * w;
        if (h > H - 2 * M) { h = H - 2 * M; w = (img.naturalWidth / img.naturalHeight) * h; }
        if (y + h > H - M) { doc.addPage(); y = M; }
        doc.addImage(p.image, 'JPEG', M, y, w, h); y += h + 14;
      }
      y += 8;
    }
  }
  if (!rows.length && !pages.length) write('No entries yet.', 11);
  return doc.output('blob');
}
async function pdfFlow(records) {
  const hasPhotos = records.some((r) => r.type === 'page' && r.image);
  const m = modal(`<h2>Save as PDF</h2>
    <p class="muted small">A PDF is <strong>not</strong> encrypted. Anyone who opens the file can read it. Keep it somewhere private, or print it and delete the file.</p>
    ${hasPhotos ? '<label style="display:flex;gap:10px;align-items:center;font-weight:500"><input type="checkbox" id="pdf-ph" checked style="width:auto"> Include photos of handwritten pages</label>' : ''}
    <div class="row" style="margin-top:16px"><button class="btn ghost block" data-x="no">Cancel</button><button class="btn primary block" data-x="go">Create PDF</button></div>`);
  m.el.querySelector('[data-x=no]').onclick = m.close;
  const go = m.el.querySelector('[data-x=go]');
  go.onclick = () => busy(go, async () => {
    try { const blob = await buildPdf(records, !!m.el.querySelector('#pdf-ph')?.checked); m.close(); await deliverFile(blob, `step4-inventory-${todayNY()}.pdf`); }
    catch (e) { toast(errMsg(e), 4000); }
  });
}
ACT.s4Pdf = () => pdfFlow(S.s4 || []);

async function encryptBackup(records, pass) {
  const salt = rand(16), iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kekFrom(pass, salt),
    new TextEncoder().encode(JSON.stringify({ v: 1, exported: new Date().toISOString(), records }))));
  return new Blob([JSON.stringify({ app: 'new-mercies-step4', v: 1, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) })], { type: 'application/octet-stream' });
}
async function decryptBackup(file, pass) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { j = null; }
  if (!j || j.app !== 'new-mercies-step4') throw new Error("That file isn't a New Mercies Step 4 backup.");
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, await kekFrom(pass, b64d(j.salt)), b64d(j.ct));
    return JSON.parse(new TextDecoder().decode(pt)).records || [];
  } catch (_) { throw new Error('Wrong backup password.'); }
}
ACT.s4Backup = () => {
  const m = modal(`<h2>Encrypted backup</h2>
    <p class="muted small">Choose a backup password. You'll need it to restore. If you forget it, the backup can't be opened by anyone, including you.</p>
    <div class="stack"><div><label for="bk1">Backup password</label><input id="bk1" type="password" autocomplete="new-password"></div>
    <div><label for="bk2">Confirm</label><input id="bk2" type="password" autocomplete="new-password"></div><p class="error" id="bk-err"></p>
    <div class="row"><button class="btn ghost block" data-x="no">Cancel</button><button class="btn primary block" data-x="go">Create backup</button></div></div>`);
  m.el.querySelector('[data-x=no]').onclick = m.close;
  const go = m.el.querySelector('[data-x=go]');
  go.onclick = () => busy(go, async () => {
    const a = m.el.querySelector('#bk1').value, b = m.el.querySelector('#bk2').value, err = m.el.querySelector('#bk-err');
    if (a.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { err.textContent = "Passwords don't match."; return; }
    const blob = await encryptBackup(await s4All(), a); m.close();
    await deliverFile(blob, `new-mercies-step4-backup-${todayNY()}.nmb`);
    toast('Backup created. Store it somewhere safe.', 3500);
  });
};
function backupPicker(title, note, okLabel, onOk) {
  const m = modal(`<h2>${esc(title)}</h2><p class="muted small">${note}</p>
    <div class="stack"><div><label for="rs-f">Backup file</label><input id="rs-f" type="file" accept=".nmb,application/octet-stream,*/*"></div>
    <div><label for="rs-p">Backup password</label><input id="rs-p" type="password"></div><p class="error" id="rs-err"></p>
    <div class="row"><button class="btn ghost block" data-x="no">Cancel</button><button class="btn primary block" data-x="go">${esc(okLabel)}</button></div></div>`);
  m.el.querySelector('[data-x=no]').onclick = m.close;
  const go = m.el.querySelector('[data-x=go]');
  go.onclick = () => busy(go, async () => {
    const f = m.el.querySelector('#rs-f').files[0], err = m.el.querySelector('#rs-err');
    if (!f) { err.textContent = 'Choose your backup file.'; return; }
    try { const recs = await decryptBackup(f, m.el.querySelector('#rs-p').value); m.close(); await onOk(recs); }
    catch (e) { err.textContent = errMsg(e); }
  });
}
ACT.s4Restore = () => backupPicker('Restore from a backup', 'Entries from the backup are added to this phone. Entries already here stay.', 'Restore', async (recs) => {
  for (const r of recs) await s4Put(r);
  toast(`Restored ${recs.length} ${recs.length === 1 ? 'item' : 'items'}.`); renderView();
});
// Open a backup without an account (for someone who has left the group)
ACT.openBackupNoAccount = () => backupPicker('Open a Step 4 backup', "Read a backup you made earlier, even without an account. You'll get a PDF of its contents.", 'Open', (recs) => pdfFlow(recs));


// ---------- Wiring -------------------------------------------------------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

// Re-lock after the app has been in the background
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { S.hiddenAt = Date.now(); return; }
  if (!S.unlocked) return;
  if (Date.now() - S.hiddenAt > CONFIG.relockAfterMs) { closeModals(); renderLock(); }
  else if (S.todayCheckin && S.todayCheckin.day !== todayNY()) { S.todayCheckin = null; go('today'); } // a new day began
});

window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1);
  if (S.unlocked && TABS.includes(t) && t !== S.tab) go(t);
});

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) return renderAuth('signin');
  if (!localStorage.getItem(PIN_KEY)) return renderSetPin();
  renderLock();
}
boot();
})();
