import { fmtTime, fmtDayLabel, etDateKey } from './time.js';
import { SOURCE_LABEL } from './events.js';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

const CSS = `
:root{--blue:#012169;--ink:#1d1d1f;--muted:#5f6368;--line:#e4e6eb;--bg:#f7f8fa;--card:#fff;--accent:#c84e00}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--blue);color:#fff;padding:28px 20px 24px}header a{color:#fff;text-decoration:none}
header h1{margin:0;font-size:28px;letter-spacing:-.5px}header p{margin:6px 0 0;opacity:.85}
main{max-width:720px;margin:0 auto;padding:20px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:28px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 10px}
.card .t{font-weight:600;font-size:17px}.card .t a{color:var(--ink);text-decoration:none}.card .t a:hover{text-decoration:underline}
.meta{color:var(--muted);font-size:14px;margin-top:2px}.food{margin-top:6px;font-size:14px}
.badge{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;color:var(--muted);margin-left:6px;vertical-align:2px}
.time{color:var(--accent);font-weight:600}
.empty{color:var(--muted);font-style:italic;padding:4px 2px 10px}
form.sub{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
input,select,textarea{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}
form.sub input[type=email]{flex:1;min-width:200px}
button{font:inherit;font-weight:600;padding:10px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
button.sec{background:#e8eaed;color:var(--ink)}button.danger{background:#b3261e}
.grid{display:grid;gap:10px}.grid label{font-size:14px;color:var(--muted);display:grid;gap:4px}
.hp{position:absolute;left:-9999px}
footer{max-width:720px;margin:0 auto;padding:10px 20px 40px;color:var(--muted);font-size:13px}footer a{color:var(--muted)}
.row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.note{background:#fff8e1;border:1px solid #f3e2a9;border-radius:8px;padding:10px 12px;font-size:14px}
`;

export function page(env, title, body, { robots = true } = {}) {
  const name = esc(env.SITE_NAME || 'Duke Bites');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${robots ? '' : '<meta name="robots" content="noindex">'}
<style>${CSS}</style></head><body>
<header><a href="/"><h1>${name}</h1></a><p>Every free food event at Duke, in one place.</p></header>
<main>${body}</main>
<footer>Sources: Duke Event Calendar, DukeGroups, club Instagram accounts, and student tips.
Check event details with the host before you go. <a href="/tip">Submit an event</a> · <a href="/events.ics">Add to calendar</a></footer>
</body></html>`;
}

export function eventCard(e, { admin = false } = {}) {
  const url = safeUrl(e.url);
  const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
  const when = e.all_day ? 'All day' : fmtTime(e.start_ms) + (e.end_ms ? '–' + fmtTime(e.end_ms) : '');
  const where = e.location ? ` · ${esc(e.location)}` : '';
  const org = e.org ? `<div class="meta">${esc(e.org)}</div>` : '';
  const food = e.food ? `<div class="food">🍽 ${esc(e.food)}</div>` : '';
  const day = admin ? `${fmtDayLabel(etDateKey(e.start_ms))} · ` : '';
  const actions = admin
    ? `<form class="row" method="post" action="/admin/action">
        <input type="hidden" name="id" value="${esc(e.id)}">
        ${e.status !== 'approved' ? '<button name="action" value="approve">Approve</button>' : ''}
        ${e.status !== 'hidden' ? '<button class="danger" name="action" value="hide">Hide</button>' : ''}
      </form>`
    : '';
  return `<div class="card"><div class="t">${title}<span class="badge">${esc(SOURCE_LABEL[e.source] || e.source)}</span></div>
<div class="meta">${day}<span class="time">${when}</span>${where}</div>${org}${food}${actions}</div>`;
}

export function homePage(env, groups, notice = '') {
  const total = groups.reduce((n, g) => n + g.events.length, 0);
  const days = groups
    .map((g, i) => {
      const label = i === 0 ? 'Today · ' + fmtDayLabel(g.key) : i === 1 ? 'Tomorrow · ' + fmtDayLabel(g.key) : fmtDayLabel(g.key);
      const body = g.events.length ? g.events.map((e) => eventCard(e)).join('') : '<div class="empty">Nothing listed yet.</div>';
      return `<h2>${esc(label)}</h2>${body}`;
    })
    .join('');
  return page(
    env,
    `${env.SITE_NAME || 'Duke Bites'}: free food at Duke`,
    `${notice ? `<div class="note">${esc(notice)}</div>` : ''}
<div class="card"><div class="t">Get the list every morning</div>
<div class="meta">${total} food event${total === 1 ? '' : 's'} this week. One email a day, unsubscribe anytime.</div>
<form class="sub" method="post" action="/subscribe">
<input type="email" name="email" placeholder="netid@duke.edu" required autocomplete="email">
<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button>Subscribe</button></form></div>${days}`
  );
}

export function eventForm(action, button, { tip = false } = {}) {
  return `<form method="post" action="${action}" class="grid">
<label>Event name<input name="title" required maxlength="200"></label>
<label>Date<input type="date" name="date" required></label>
<label>Start time<input type="time" name="start"></label>
<label>End time<input type="time" name="end"></label>
<label>Location<input name="location" maxlength="200"></label>
<label>Hosted by<input name="org" maxlength="200"></label>
<label>What food?<input name="food" maxlength="200" placeholder="Pizza, boba, Chick-fil-A..."></label>
<label>Link (event page or Instagram post)<input type="url" name="url" maxlength="500"></label>
${tip ? '<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' : ''}
<button>${esc(button)}</button></form>`;
}

export function messagePage(env, title, msg) {
  return page(env, title, `<div class="card"><div class="t">${esc(title)}</div><div class="meta">${esc(msg)}</div></div><p><a href="/">← Back to events</a></p>`);
}
