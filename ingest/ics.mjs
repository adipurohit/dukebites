// Minimal iCalendar (RFC 5545) reader, enough for CampusGroups/DukeGroups feeds.
import { zonedToUtcMs, TZ } from '../src/time.js';

export function parseICS(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // 1) RFC folding: a line starting with space/tab continues the previous line.
  const unfolded = [];
  for (const l of raw) {
    if ((l.startsWith(' ') || l.startsWith('\t')) && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1);
    else unfolded.push(l);
  }
  // 2) Quoted-printable soft breaks: a QP value ending in "=" continues on the next line.
  const lines = [];
  for (let i = 0; i < unfolded.length; i++) {
    let l = unfolded[i];
    if (/QUOTED-PRINTABLE/i.test(l.split(':')[0])) {
      while (l.endsWith('=') && i + 1 < unfolded.length) l = l.slice(0, -1) + unfolded[++i];
    }
    lines.push(l);
  }

  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur || !line) continue;
    const prop = parseLine(line);
    if (prop && !(prop.name in cur)) cur[prop.name] = prop;
  }
  return events;
}

function parseLine(line) {
  // NAME;PARAM=val;PARAM="quoted:val":VALUE
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  let value = line.slice(i + 1);
  const [name, ...paramParts] = splitParams(head);
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  if ((params.ENCODING || '').toUpperCase() === 'QUOTED-PRINTABLE') value = qpDecode(value);
  return { name: name.toUpperCase(), params, value };
}

function splitParams(head) {
  const out = [];
  let buf = '', inQ = false;
  for (const c of head) {
    if (c === '"') inQ = !inQ;
    if (c === ';' && !inQ) { out.push(buf); buf = ''; } else buf += c;
  }
  out.push(buf);
  return out;
}

function qpDecode(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of new TextEncoder().encode(s[i])) bytes.push(b);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function icsText(prop) {
  if (!prop) return '';
  return prop.value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

// Returns { ms, allDay } or null.
export function icsDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || (prop.params.VALUE || '').toUpperCase() === 'DATE') {
    m = m || v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { ms: zonedToUtcMs(+m[1], +m[2], +m[3], 0, 0, 0, TZ), allDay: true };
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', z] = m;
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  const tz = prop.params.TZID || TZ;
  try {
    return { ms: zonedToUtcMs(+y, +mo, +d, +h, +mi, +s, tz), allDay: false };
  } catch {
    return { ms: zonedToUtcMs(+y, +mo, +d, +h, +mi, +s, TZ), allDay: false };
  }
}
