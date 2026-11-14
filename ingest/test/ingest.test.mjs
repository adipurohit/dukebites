import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foodMatch } from '../food.mjs';
import * as dg from '../sources/dukegroups.mjs';
import * as dc from '../sources/duke-calendar.mjs';
import * as ig from '../sources/instagram.mjs';
import { etDateKey, fmtTime, etLocalToMs, etDayBounds } from '../../src/time.js';

const fx = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-14T12:00:00Z');

test('food matcher', () => {
  assert.equal(foodMatch('Free pizza at 6').strong, true);
  assert.equal(foodMatch('Lunch will be provided').strong, true);
  assert.equal(foodMatch('Join our food drive for the food bank').match, false);
  assert.equal(foodMatch('Tickets are $25. Dinner included.').strong, false);
  assert.equal(foodMatch('Cookies in the commons').match, true);
  assert.equal(foodMatch('Cookies in the commons').strong, false);
  assert.equal(foodMatch('A lecture on quantum dots').match, false);
});

test('time helpers handle DST', () => {
  assert.equal(new Date(etLocalToMs('2026-11-16', '12:00')).toISOString(), '2026-11-16T17:00:00.000Z'); // EST
  assert.equal(new Date(etLocalToMs('2026-07-01', '12:00')).toISOString(), '2026-07-01T16:00:00.000Z'); // EDT
  const [s, e] = etDayBounds('2026-11-01'); // DST ends: 25-hour day
  assert.equal((e - s) / 3600e3, 25);
  assert.equal(etDateKey(Date.parse('2026-11-15T03:00:00Z')), '2026-11-14');
});

test('dukegroups ics parsing + filtering', () => {
  const ev = dg.normalize(fx('dukegroups.ics'), { now: NOW, days: 14 });
  const byId = Object.fromEntries(ev.map((e) => [e.id, e]));
  assert.ok(byId['dukegroups:CG-111'], 'boba event found');
  assert.equal(byId['dukegroups:CG-111'].title, 'Mooncake – Game Night', 'quoted-printable decoded');
  assert.equal(byId['dukegroups:CG-111'].status, 'approved');
  assert.equal(byId['dukegroups:CG-111'].org, 'Duke Chinese Students: Social');
  assert.match(byId['dukegroups:CG-111'].food, /first come first served/, 'folded line joined');
  assert.equal(byId['dukegroups:CG-111'].location, 'See DukeGroups for location');
  assert.equal(byId['dukegroups:CG-222'], undefined, 'food drive excluded');
  assert.equal(fmtTime(byId['dukegroups:CG-333'].start_ms), '12:00 PM', 'TZID handled');
  assert.equal(byId['dukegroups:CG-444'].status, 'pending', 'paid event goes to review');
  assert.equal(byId['dukegroups:CG-555'].status, 'pending', 'weak match goes to review');
  assert.equal(byId['dukegroups:CG-OLD'], undefined, 'past event dropped');
  assert.equal(byId['dukegroups:CG-666'].all_day, 1);
});

test('duke calendar json', () => {
  const ev = dc.normalize(JSON.parse(fx('dukecal.json')).events);
  assert.equal(ev.length, 2);
  assert.match(ev[0].food, /empanadas/);
  assert.equal(ev[1].title, 'Seminar Series');
  assert.equal(ev[1].all_day, 0);
  assert.equal(ev[1].food, 'Listed as free food on the Duke calendar');
  assert.ok(ev.every((e) => e.status === 'approved'));
});

test('instagram reply -> event', () => {
  const post = { id: '999', caption: 'Pizza night Thursday 7pm in the Bryan Center!', permalink: 'https://www.instagram.com/p/x/', timestamp: '2026-11-14T10:00:00+0000' };
  const r = ig.parseReply('Here you go: {"is_food_event":true,"title":"Pizza Night","date":"2026-11-19","start_time":"19:00","end_time":null,"location":"Bryan Center","food":"pizza"}');
  const e = ig.toEvent(r, { handle: 'dukeclub', orgName: 'Duke Club', post, now: NOW });
  assert.equal(e.id, 'ig:999');
  assert.equal(e.status, 'pending');
  assert.equal(fmtTime(e.start_ms), '7:00 PM');
  assert.equal(ig.toEvent({ is_food_event: false }, { handle: 'x', orgName: 'x', post, now: NOW }), null);
  assert.equal(ig.toEvent({ ...r, date: '2026-11-01' }, { handle: 'x', orgName: 'x', post, now: NOW }), null, 'past event dropped');
  assert.match(ig.buildPrompt({ handle: 'dukeclub', post, now: NOW }), /Today is 2026-11-14/);
});
