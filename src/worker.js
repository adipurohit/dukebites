import { etDateKey, etLocalToMs, fmtDayLabel } from './time.js';
import { eventsForDays } from './events.js';
import { homePage, page, eventCard, eventForm, messagePage, esc } from './html.js';
import { digestEmail, confirmEmail, sendOne, sendBatch } from './email.js';

const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function token() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function siteUrl(env, req) {
  return (env.SITE_URL && !env.SITE_URL.includes('example.com') ? env.SITE_URL : new URL(req.url).origin).replace(/\/$/, '');
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(pass, env.ADMIN_PASSWORD);
}

const needAuth = () =>
  new Response('Login required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="admin"' } });

// Block cross-site form posts to admin endpoints.
function sameOrigin(req) {
  const o = req.headers.get('origin');
  return !o || o === new URL(req.url).origin;
}

function clip(s, n) {
  s = (s ?? '').toString().trim();
  return s ? s.slice(0, n) : null;
}

function eventFromForm(f, source, status) {
  const date = f.get('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Pick a date.');
  const title = clip(f.get('title'), 200);
  if (!title) throw new Error('Add an event name.');
  const start = f.get('start');
  const end = f.get('end');
  const now = Date.now();
  return {
    id: `${source}:${token().slice(0, 16)}`,
    source,
    title,
    description: null,
    start_ms: etLocalToMs(date, start || '00:00'),
    end_ms: end ? etLocalToMs(date, end) : null,
    all_day: start ? 0 : 1,
    location: clip(f.get('location'), 200),
    url: clip(f.get('url'), 500),
    org: clip(f.get('org'), 200),
    food: clip(f.get('food'), 200),
    status,
    created_at: now,
    updated_at: now,
  };
}

const COLS = ['id', 'source', 'title', 'description', 'start_ms', 'end_ms', 'all_day', 'location', 'url', 'org', 'food', 'status', 'created_at', 'updated_at'];

function upsertStmt(db, e) {
  // On conflict, refresh details but keep the existing status so admin decisions stick.
  return db
    .prepare(
      `INSERT INTO events (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
         start_ms=excluded.start_ms, end_ms=excluded.end_ms, all_day=excluded.all_day,
         location=excluded.location, url=excluded.url, org=excluded.org, food=excluded.food,
         updated_at=excluded.updated_at`
    )
    .bind(...COLS.map((c) => e[c] ?? null));
}

function validIngest(e) {
  return (
    e && typeof e.id === 'string' && e.id.length < 300 &&
    typeof e.title === 'string' && e.title.trim() &&
    Number.isFinite(e.start_ms) &&
    ['approved', 'pending'].includes(e.status || 'approved')
  );
}

async function handleIngest(req, env) {
  const auth = req.headers.get('authorization') || '';
  if (!env.INGEST_TOKEN || !timingSafeEqual(auth, `Bearer ${env.INGEST_TOKEN}`)) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.events)) return json({ error: 'expected {events:[...]}' }, 400);
  const now = Date.now();
  const good = body.events.filter(validIngest).slice(0, 5000).map((e) => ({
    ...e,
    title: e.title.slice(0, 200),
    description: e.description ? String(e.description).slice(0, 1000) : null,
    location: e.location ? String(e.location).slice(0, 200) : null,
    org: e.org ? String(e.org).slice(0, 200) : null,
    food: e.food ? String(e.food).slice(0, 300) : null,
    url: e.url ? String(e.url).slice(0, 500) : null,
    end_ms: Number.isFinite(e.end_ms) ? e.end_ms : null,
    all_day: e.all_day ? 1 : 0,
    status: e.status || 'approved',
    created_at: now,
    updated_at: now,
  }));
  for (let i = 0; i < good.length; i += 50) {
    await env.DB.batch(good.slice(i, i + 50).map((e) => upsertStmt(env.DB, e)));
  }
  return json({ received: body.events.length, stored: good.length });
}

async function handleSubscribe(req, env) {
  const f = await req.formData();
  if (f.get('website')) return html(messagePage(env, 'Thanks!', 'Check your inbox.')); // honeypot
  const email = (f.get('email') || '').toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return html(messagePage(env, 'Hmm', 'That email does not look right.'), 400);

  const existing = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
  if (existing && existing.status === 'active') return html(messagePage(env, 'Already subscribed', 'You are on the list. See you tomorrow morning.'));
  const tok = existing ? existing.token : token();
  if (!existing) {
    await env.DB.prepare('INSERT INTO subscribers (email, token, status, created_at) VALUES (?, ?, ?, ?)').bind(email, tok, 'pending', Date.now()).run();
  } else {
    await env.DB.prepare("UPDATE subscribers SET status = 'pending' WHERE email = ?").bind(email).run();
  }
  await sendOne(env, email, confirmEmail(env, `${siteUrl(env, req)}/confirm?t=${tok}`));
  return html(messagePage(env, 'Almost done', `We sent a confirmation link to ${email}. Tap it to start getting the daily list.`));
}

async function handleConfirm(url, env) {
  const t = url.searchParams.get('t') || '';
  const r = await env.DB.prepare("UPDATE subscribers SET status = 'active', confirmed_at = ? WHERE token = ? AND status != 'unsubscribed'").bind(Date.now(), t).run();
  if (!r.meta.changes) return html(messagePage(env, 'Link expired', 'Subscribe again from the home page.'), 400);
  return html(messagePage(env, "You're in", 'The free food list lands in your inbox every morning.'));
}

async function handleUnsubscribe(url, env, oneClick) {
  const t = url.searchParams.get('t') || '';
  await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE token = ?").bind(t).run();
  if (oneClick) return new Response('ok');
  return html(messagePage(env, 'Unsubscribed', 'You will not get more emails. Resubscribe anytime from the home page.'));
}

async function handleTip(req, env) {
  const f = await req.formData();
  if (f.get('website')) return html(messagePage(env, 'Thanks!', 'Got it.'));
  try {
    const e = eventFromForm(f, 'tip', 'pending');
    await upsertStmt(env.DB, e).run();
  } catch (err) {
    return html(messagePage(env, 'Missing info', err.message), 400);
  }
  return html(messagePage(env, 'Thanks!', 'We will check the event and add it to the list.'));
}

async function adminPage(req, env, notice = '') {
  const now = Date.now();
  const today = etDateKey(now);
  const pending = (await env.DB.prepare("SELECT * FROM events WHERE status = 'pending' AND COALESCE(end_ms, start_ms) >= ? ORDER BY start_ms LIMIT 200").bind(now - 6 * 3600e3).all()).results;
  const groups = await eventsForDays(env.DB, today, 7);
  const subs = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status").all();
  const counts = Object.fromEntries(subs.results.map((r) => [r.status, r.n]));
  const body = `${notice ? `<div class="note">${esc(notice)}</div>` : ''}
<div class="card"><div class="t">Admin</div><div class="meta">Subscribers: ${counts.active || 0} active, ${counts.pending || 0} unconfirmed, ${counts.unsubscribed || 0} unsubscribed.
<a href="/admin/preview">Preview today's email</a></div>
<form method="post" action="/admin/send-now" class="row"><button class="sec">Send today's email now</button></form></div>
<h2>Needs review (${pending.length})</h2>${pending.map((e) => eventCard(e, { admin: true })).join('') || '<div class="empty">Nothing waiting.</div>'}
<h2>Add an event</h2><div class="card">${eventForm('/admin/add', 'Add event')}</div>
${groups.map((g) => `<h2>${esc(fmtDayLabel(g.key))}</h2>${g.events.map((e) => eventCard(e, { admin: true })).join('') || '<div class="empty">None.</div>'}`).join('')}`;
  return html(page(env, 'Admin', body, { robots: false }));
}

async function sendDigest(env, origin, { force = false } = {}) {
  const day = etDateKey(Date.now());
  if (!force) {
    const done = await env.DB.prepare('SELECT day FROM sends WHERE day = ?').bind(day).first();
    if (done) return { skipped: 'already sent', day };
  }
  const [group] = await eventsForDays(env.DB, day, 1);
  if (!group.events.length) return { skipped: 'no events', day };
  const subs = (await env.DB.prepare("SELECT email, token FROM subscribers WHERE status = 'active'").all()).results;
  const messages = subs.map((s) => {
    const unsubUrl = `${origin}/unsubscribe?t=${s.token}`;
    return { to: s.email, unsubUrl, ...digestEmail(env, day, group.events, unsubUrl) };
  });
  const sent = await sendBatch(env, messages);
  await env.DB.prepare('INSERT OR REPLACE INTO sends (day, recipients, events, sent_at) VALUES (?, ?, ?, ?)').bind(day, sent, group.events.length, Date.now()).run();
  return { day, sent, events: group.events.length };
}

function icsFeed(env, events) {
  const fmt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${escI(env.SITE_NAME || 'Duke Bites')}//EN`, `X-WR-CALNAME:${escI(env.SITE_NAME || 'Duke Bites')}`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${escI(e.id)}`, `DTSTAMP:${fmt(Date.now())}`, `DTSTART:${fmt(e.start_ms)}`);
    if (e.end_ms) lines.push(`DTEND:${fmt(e.end_ms)}`);
    lines.push(`SUMMARY:${escI(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escI(e.location)}`);
    if (e.food) lines.push(`DESCRIPTION:${escI('Food: ' + e.food)}`);
    if (e.url) lines.push(`URL:${escI(e.url)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname: p } = url;
    const m = req.method;
    try {
      if (m === 'GET' && p === '/') {
        const groups = await eventsForDays(env.DB, etDateKey(Date.now()), 7);
        return html(homePage(env, groups), 200, { 'cache-control': 'public, max-age=300' });
      }
      if (m === 'GET' && p === '/events.json') {
        const groups = await eventsForDays(env.DB, etDateKey(Date.now()), 7);
        return json({ days: groups });
      }
      if (m === 'GET' && p === '/events.ics') {
        const groups = await eventsForDays(env.DB, etDateKey(Date.now()), 14);
        return new Response(icsFeed(env, groups.flatMap((g) => g.events)), { headers: { 'content-type': 'text/calendar; charset=utf-8' } });
      }
      if (m === 'POST' && p === '/subscribe') return handleSubscribe(req, env);
      if (m === 'GET' && p === '/confirm') return handleConfirm(url, env);
      if (p === '/unsubscribe' && (m === 'GET' || m === 'POST')) return handleUnsubscribe(url, env, m === 'POST');
      if (m === 'GET' && p === '/tip') return html(page(env, 'Submit an event', `<h2>Submit a free food event</h2><div class="card">${eventForm('/tip', 'Send', { tip: true })}</div>`));
      if (m === 'POST' && p === '/tip') return handleTip(req, env);
      if (m === 'POST' && p === '/api/ingest') return handleIngest(req, env);

      if (p.startsWith('/admin')) {
        if (!isAdmin(req, env)) return needAuth();
        if (m === 'POST' && !sameOrigin(req)) return new Response('bad origin', { status: 403 });
        if (m === 'GET' && p === '/admin') return adminPage(req, env);
        if (m === 'GET' && p === '/admin/preview') {
          const day = etDateKey(Date.now());
          const [g] = await eventsForDays(env.DB, day, 1);
          return html(digestEmail(env, day, g.events, '#').html);
        }
        if (m === 'POST' && p === '/admin/add') {
          const f = await req.formData();
          try {
            await upsertStmt(env.DB, eventFromForm(f, 'manual', 'approved')).run();
          } catch (err) {
            return adminPage(req, env, err.message);
          }
          return adminPage(req, env, 'Event added.');
        }
        if (m === 'POST' && p === '/admin/action') {
          const f = await req.formData();
          const action = f.get('action');
          const status = action === 'approve' ? 'approved' : action === 'hide' ? 'hidden' : null;
          if (status) await env.DB.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind(status, Date.now(), f.get('id')).run();
          return Response.redirect(url.origin + '/admin', 303);
        }
        if (m === 'POST' && p === '/admin/send-now') {
          const r = await sendDigest(env, siteUrl(env, req), { force: true });
          return adminPage(req, env, r.skipped ? `Not sent: ${r.skipped}.` : `Sent to ${r.sent} subscribers (${r.events} events).`);
        }
      }
      return html(messagePage(env, 'Not found', 'That page does not exist.'), 404);
    } catch (err) {
      console.error(err);
      return html(messagePage(env, 'Error', 'Something went wrong. Try again in a minute.'), 500);
    }
  },

  async scheduled(controller, env, ctx) {
    const origin = (env.SITE_URL || '').replace(/\/$/, '');
    ctx.waitUntil(sendDigest(env, origin).then((r) => console.log('digest', JSON.stringify(r))));
  },
};
