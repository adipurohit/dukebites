import { esc, safeUrl } from './html.js';
import { fmtTime, fmtDayLabel } from './time.js';
import { SOURCE_LABEL } from './events.js';

function when(e) {
  return e.all_day ? 'All day' : fmtTime(e.start_ms) + (e.end_ms ? '–' + fmtTime(e.end_ms) : '');
}

export function digestEmail(env, dayKey, events, unsubUrl) {
  const site = env.SITE_URL || '';
  const name = env.SITE_NAME || 'Duke Bites';
  const subject = `${events.length} free food event${events.length === 1 ? '' : 's'} at Duke today · ${fmtDayLabel(dayKey)}`;

  const rows = events
    .map((e) => {
      const url = safeUrl(e.url);
      const title = url
        ? `<a href="${esc(url)}" style="color:#012169;text-decoration:none">${esc(e.title)}</a>`
        : esc(e.title);
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #e4e6eb">
<div style="font-weight:600;font-size:16px">${title}</div>
<div style="color:#5f6368;font-size:14px"><span style="color:#c84e00;font-weight:600">${esc(when(e))}</span>${e.location ? ' · ' + esc(e.location) : ''}</div>
${e.org ? `<div style="color:#5f6368;font-size:14px">${esc(e.org)}</div>` : ''}
${e.food ? `<div style="font-size:14px;margin-top:4px">🍽 ${esc(e.food)}</div>` : ''}
<div style="color:#9aa0a6;font-size:12px;margin-top:2px">via ${esc(SOURCE_LABEL[e.source] || e.source)}</div>
</td></tr>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;border:1px solid #e4e6eb">
<tr><td style="background:#012169;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
<div style="font-size:22px;font-weight:700">${esc(name)}</div>
<div style="opacity:.85">${esc(fmtDayLabel(dayKey))}</div></td></tr>
<tr><td style="padding:8px 24px 16px"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
<tr><td style="padding:0 24px 20px;font-size:13px;color:#5f6368">
<a href="${esc(site)}" style="color:#012169">See the full week</a> · <a href="${esc(site)}/tip" style="color:#012169">Submit an event</a><br><br>
Confirm details with the host before you go. <a href="${esc(unsubUrl)}" style="color:#5f6368">Unsubscribe</a>
</td></tr></table></td></tr></table></body></html>`;

  const text =
    `${name} · ${fmtDayLabel(dayKey)}\n\n` +
    events
      .map((e) => `${when(e)}  ${e.title}${e.location ? ' @ ' + e.location : ''}${e.food ? '\n  Food: ' + e.food : ''}${e.url ? '\n  ' + e.url : ''}`)
      .join('\n\n') +
    `\n\nFull week: ${site}\nUnsubscribe: ${unsubUrl}\n`;

  return { subject, html, text };
}

export function confirmEmail(env, confirmUrl) {
  const name = env.SITE_NAME || 'Duke Bites';
  return {
    subject: `Confirm your ${name} subscription`,
    html: `<p>Tap to start getting Duke's free food events every morning:</p><p><a href="${esc(confirmUrl)}">Confirm subscription</a></p><p style="color:#5f6368;font-size:13px">If you didn't sign up, ignore this email.</p>`,
    text: `Confirm your subscription: ${confirmUrl}\n\nIf you didn't sign up, ignore this email.`,
  };
}

async function resend(env, path, body) {
  const res = await fetch('https://api.resend.com' + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function sendOne(env, to, msg) {
  if (!env.RESEND_API_KEY) {
    console.log('[email:dry-run]', to, msg.subject);
    return;
  }
  return resend(env, '/emails', { from: env.FROM_EMAIL, to: [to], subject: msg.subject, html: msg.html, text: msg.text });
}

// messages: [{ to, subject, html, text, unsubUrl }]
export async function sendBatch(env, messages) {
  if (!env.RESEND_API_KEY) {
    for (const m of messages) console.log('[email:dry-run]', m.to, m.subject);
    return messages.length;
  }
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({
      from: env.FROM_EMAIL,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }));
    await resend(env, '/emails/batch', chunk);
    sent += chunk.length;
  }
  return sent;
}
