// Duke Event Calendar: official public JSON feed, filtered to the
// "Free Food and Beverages" category. Every result is food by definition.
import { foodMatch, stripHtml } from '../food.mjs';

export const name = 'duke-calendar';

export function feedUrl(days = 14) {
  const cat = encodeURIComponent('Free Food and Beverages');
  return `https://calendar.duke.edu/events/index.json?cfu[]=${cat}&future_days=${days}&feed_type=simple`;
}

export async function fetchEvents({ fetch: f = fetch, userAgent, days = 14 } = {}) {
  const res = await f(feedUrl(days), { headers: { 'user-agent': userAgent, accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return normalize(data.events || []);
}

export function normalize(list) {
  const out = [];
  for (const e of list) {
    const start = Date.parse(e.start_timestamp);
    if (!Number.isFinite(start)) continue;
    const end = e.end_timestamp ? Date.parse(e.end_timestamp) : NaN;
    const desc = stripHtml(e.description);
    const text = `${e.summary} ${desc}`.replace(/\s+/g, ' ');
    const fm = foodMatch(text);
    // Already tagged as food, so any "free X" phrase is a fine description.
    const freeX = text.match(/\bfree\s+(?!and\b|to\b|of\b|for\b|admission\b|event\b|entry\b|parking\b)[a-z][\w-]*(\s+(and|&)\s+[a-z][\w-]*)?/i);
    if (!fm.snippet && freeX) fm.snippet = freeX[0];
    out.push({
      id: `dukecal:${e.id}`,
      source: name,
      title: stripHtml(e.summary).replace(/^"(.*)"$/, '$1'),
      description: desc.slice(0, 1000),
      start_ms: start,
      end_ms: Number.isFinite(end) ? end : null,
      all_day: e.allday === true || e.allday === 'true' ? 1 : 0,
      location: e.location?.address || null,
      url: e.event_url || e.link || null,
      org: e.sponsor || null,
      food: fm.snippet || 'Listed as free food on the Duke calendar',
      status: 'approved',
    });
  }
  return out;
}
