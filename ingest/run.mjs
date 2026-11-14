#!/usr/bin/env node
// Collect Duke food events and push them to the Worker.
//
//   node ingest/run.mjs                         # all sources
//   node ingest/run.mjs --sources instagram     # one source
//   node ingest/run.mjs --dry-run               # print, don't upload
//
// Env: WORKER_URL, INGEST_TOKEN (+ Instagram vars, see sources/instagram.mjs)
import * as dukeCalendar from './sources/duke-calendar.mjs';
import * as dukegroups from './sources/dukegroups.mjs';
import * as instagram from './sources/instagram.mjs';
import { fmtTime, etDateKey } from '../src/time.js';

const ALL = { [dukeCalendar.name]: dukeCalendar, [dukegroups.name]: dukegroups, [instagram.name]: instagram };
const UA = 'DukeBites/1.0 (student free-food digest)';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const si = args.indexOf('--sources');
const chosen = si >= 0 ? args[si + 1].split(',') : Object.keys(ALL);

const events = [];
let failures = 0;
for (const key of chosen) {
  const src = ALL[key];
  if (!src) { console.error(`unknown source: ${key}`); process.exit(2); }
  try {
    const list = await src.fetchEvents({ userAgent: UA });
    const pending = list.filter((e) => e.status === 'pending').length;
    console.log(`${key}: ${list.length} food events (${pending} need review)`);
    events.push(...list);
  } catch (err) {
    failures++;
    console.error(`${key}: FAILED ${err.message}`);
  }
}

if (dryRun || !process.env.WORKER_URL) {
  if (!dryRun) console.log('WORKER_URL not set, printing instead of uploading.');
  for (const e of events.sort((a, b) => a.start_ms - b.start_ms)) {
    console.log(`${etDateKey(e.start_ms)} ${e.all_day ? 'all day ' : fmtTime(e.start_ms).padStart(8)}  [${e.status}] ${e.title}  ·  ${e.food || ''}`);
  }
} else {
  const res = await fetch(process.env.WORKER_URL.replace(/\/$/, '') + '/api/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.INGEST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  const body = await res.text();
  console.log(`upload: HTTP ${res.status} ${body}`);
  if (!res.ok) process.exit(1);
}

if (failures === chosen.length) process.exit(1);
