// Instagram, through Meta's official Business Discovery API (no scraping).
// Reads recent public posts from Business/Creator accounts listed in
// ingest/instagram-handles.json, then asks Claude to read the caption and
// flyer image and pull out any free-food event.
//
// Needs: IG_USER_ID, IG_ACCESS_TOKEN (your own IG professional account + Meta app),
//        ANTHROPIC_API_KEY. Personal (non-professional) accounts are not readable.
import { readFile } from 'node:fs/promises';
import { etDateKey, etLocalToMs } from '../../src/time.js';
import { foodMatch } from '../food.mjs';

export const name = 'instagram';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadHandles(path = new URL('../instagram-handles.json', import.meta.url)) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  return (data.handles || []).map((h) => h.replace(/^@/, '').trim()).filter(Boolean);
}

export async function fetchEvents({ fetch: f = fetch, env = process.env, now = Date.now() } = {}) {
  if (!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) {
    console.log('  instagram: skipped, set IG_USER_ID and IG_ACCESS_TOKEN');
    return [];
  }
  if (!env.ANTHROPIC_API_KEY) {
    console.log('  instagram: skipped, set ANTHROPIC_API_KEY to read posts');
    return [];
  }
  const handles = await loadHandles();
  const lookbackMs = Number(env.IG_LOOKBACK_HOURS || 14) * 3600e3;
  const version = env.GRAPH_VERSION || 'v26.0';
  const out = [];

  for (const handle of handles) {
    const fields = `business_discovery.username(${handle}){username,name,media.limit(10){id,caption,timestamp,permalink,media_type,media_url}}`;
    const url = `https://graph.facebook.com/${version}/${env.IG_USER_ID}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(env.IG_ACCESS_TOKEN)}`;
    let data;
    try {
      const res = await f(url);
      data = await res.json();
      if (data.error) throw new Error(data.error.message);
    } catch (err) {
      console.log(`  instagram: @${handle} failed (${err.message}). Personal accounts are not readable.`);
      continue;
    }
    const bd = data.business_discovery || {};
    const posts = (bd.media?.data || []).filter((p) => now - Date.parse(p.timestamp) <= lookbackMs);
    for (const post of posts) {
      try {
        const ev = await extract(f, env, { handle, orgName: bd.name || handle, post, now });
        if (ev) out.push(ev);
      } catch (err) {
        console.log(`  instagram: @${handle} post ${post.id} extract failed (${err.message})`);
      }
    }
    await sleep(300);
  }
  return out;
}

export function buildPrompt({ handle, post, now }) {
  return `Today is ${etDateKey(now)} (Durham, NC, Eastern time).
Below is an Instagram post by @${handle}, a Duke University account, posted ${post.timestamp}.
Caption:
"""
${(post.caption || '(no caption)').slice(0, 3000)}
"""
${post.media_url ? 'The attached image is the post image, often an event flyer.' : ''}

Does this post announce an upcoming, in-person event at or near Duke where attendees get free food or drinks?
Reply with ONLY a JSON object, no other text:
{"is_food_event": true|false,
 "title": "short event name",
 "date": "YYYY-MM-DD",
 "start_time": "HH:MM" (24h) or null,
 "end_time": "HH:MM" or null,
 "location": "building/room" or null,
 "food": "what food, a few words" or null}
Set is_food_event false for past events, paid events, food drives, or posts with no date.`;
}

export function parseReply(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

async function extract(f, env, { handle, orgName, post, now }) {
  const content = [];
  if (post.media_url && post.media_type !== 'VIDEO') content.push({ type: 'image', source: { type: 'url', url: post.media_url } });
  content.push({ type: 'text', text: buildPrompt({ handle, post, now }) });

  const res = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-haiku-5-5', max_tokens: 400, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return toEvent(parseReply(text), { handle, orgName, post, now, autoApprove: env.IG_AUTO_APPROVE === 'true' });
}

export function toEvent(r, { handle, orgName, post, now, autoApprove = false }) {
  if (!r || r.is_food_event !== true || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return null;
  const hasTime = /^\d{2}:\d{2}$/.test(r.start_time || '');
  const start = etLocalToMs(r.date, hasTime ? r.start_time : '00:00');
  const end = /^\d{2}:\d{2}$/.test(r.end_time || '') ? etLocalToMs(r.date, r.end_time) : null;
  if (start < now - 12 * 3600e3) return null; // already over
  const fm = foodMatch(post.caption || '');
  return {
    id: `ig:${post.id}`,
    source: name,
    title: String(r.title || `Event by @${handle}`).slice(0, 200),
    description: (post.caption || '').slice(0, 1000),
    start_ms: start,
    end_ms: end && end > start ? end : null,
    all_day: hasTime ? 0 : 1,
    location: r.location || null,
    url: post.permalink || `https://www.instagram.com/${handle}/`,
    org: `${orgName} (@${handle})`,
    food: r.food || fm.snippet || null,
    status: autoApprove ? 'approved' : 'pending',
  };
}
