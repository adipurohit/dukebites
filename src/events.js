import { etDateKey, etDayBounds, addDays } from './time.js';

const MAX_SPAN_MS = 36 * 3600 * 1000; // longer spans (week-long exhibits) are left out of daily lists

export async function eventsForDays(db, startKey, days) {
  const [from] = etDayBounds(startKey);
  const [, to] = etDayBounds(addDays(startKey, days - 1));
  const { results } = await db
    .prepare(
      `SELECT * FROM events
       WHERE status = 'approved' AND start_ms < ?1 AND COALESCE(end_ms, start_ms) >= ?2
       ORDER BY all_day DESC, start_ms ASC`
    )
    .bind(to, from)
    .all();

  const groups = [];
  for (let i = 0; i < days; i++) {
    const key = addDays(startKey, i);
    const [ds, de] = etDayBounds(key);
    const list = dedupe(
      results.filter((e) => {
        const end = e.end_ms || e.start_ms;
        if (end - e.start_ms > MAX_SPAN_MS) return false;
        return e.start_ms < de && end >= ds && (e.start_ms >= ds || end > ds);
      })
    );
    groups.push({ key, events: list });
  }
  return groups;
}

// The same event often shows up on the Duke calendar and DukeGroups. Keep one.
const SOURCE_RANK = { manual: 0, 'duke-calendar': 1, dukegroups: 2, instagram: 3, tip: 4 };

function normTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

export function dedupe(list) {
  const seen = new Map();
  for (const e of list) {
    const k = normTitle(e.title) + '|' + etDateKey(e.start_ms);
    const prev = seen.get(k);
    if (!prev || (SOURCE_RANK[e.source] ?? 9) < (SOURCE_RANK[prev.source] ?? 9)) seen.set(k, e);
  }
  return [...seen.values()].sort((a, b) => b.all_day - a.all_day || a.start_ms - b.start_ms);
}

export const SOURCE_LABEL = {
  'duke-calendar': 'Duke Calendar',
  dukegroups: 'DukeGroups',
  instagram: 'Instagram',
  manual: 'Curated',
  tip: 'Tip',
};
