// DukeGroups (CampusGroups): public iCal feed of student org events.
// Events have no food category, so we scan the text for food words.
import { parseICS, icsText, icsDate } from '../ics.mjs';
import { foodMatch } from '../food.mjs';

export const name = 'dukegroups';
export const FEED_URL = 'https://duke.campusgroups.com/ical/duke/ical_duke.ics';

export async function fetchEvents({ fetch: f = fetch, userAgent, days = 14, now = Date.now() } = {}) {
  const res = await f(FEED_URL, { headers: { 'user-agent': userAgent }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalize(await res.text(), { days, now });
}

export function normalize(text, { days = 14, now = Date.now() } = {}) {
  const from = now - 12 * 3600e3;
  const to = now + days * 86400e3;
  const out = [];
  for (const v of parseICS(text)) {
    const start = icsDate(v.DTSTART);
    if (!start || start.ms < from || start.ms > to) continue;
    const end = icsDate(v.DTEND);
    const title = icsText(v.SUMMARY);
    const desc = icsText(v.DESCRIPTION);
    let fm = foodMatch(desc);
    if (!fm.match) fm = foodMatch(title);
    if (!fm.match) continue;
    let location = icsText(v.LOCATION);
    if (/sign in to/i.test(location)) location = '';
    const uid = icsText(v.UID) || `${title}-${start.ms}`;
    out.push({
      id: `dukegroups:${uid}`,
      source: name,
      title,
      description: desc.slice(0, 1000),
      start_ms: start.ms,
      end_ms: end ? end.ms : null,
      all_day: start.allDay ? 1 : 0,
      location: location || 'See DukeGroups for location',
      url: icsText(v.URL) || null,
      org: v.ORGANIZER?.params?.CN || null,
      food: fm.snippet,
      status: fm.strong ? 'approved' : 'pending',
    });
  }
  return out;
}
