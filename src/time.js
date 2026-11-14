// Time helpers. All stored times are UTC milliseconds. Display is America/New_York.
// Shared by the Worker and the Node ingest script.

export const TZ = 'America/New_York';

export function tzOffsetMinutes(utcMs, tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(utcMs));
  const name = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT';
  const m = name.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
}

// Wall-clock time in a zone -> UTC ms.
export function zonedToUtcMs(y, mo, d, h = 0, mi = 0, s = 0, tz = TZ) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMinutes(guess, tz);
  let ms = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(ms, tz);
  if (off2 !== off1) ms = guess - off2 * 60000;
  return ms;
}

// "YYYY-MM-DD" for a UTC ms instant, in Eastern time.
export function etDateKey(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// [startMs, endMs) of an Eastern calendar day.
export function etDayBounds(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = addDays(dateKey, 1).split('-').map(Number);
  return [zonedToUtcMs(y, m, d), zonedToUtcMs(next[0], next[1], next[2])];
}

// "2026-11-14" + "18:30" (Eastern) -> UTC ms
export function etLocalToMs(dateKey, hhmm) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = (hhmm || '00:00').split(':').map(Number);
  return zonedToUtcMs(y, m, d, h || 0, mi || 0);
}

export function fmtTime(ms) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit',
  }).format(new Date(ms));
}

export function fmtDayLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
