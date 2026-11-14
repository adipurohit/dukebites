# Duke Bites

Every free food event at Duke, on one page and in one email each morning.

## What it does

- Pulls events from three public sources:
  - Duke Event Calendar: official JSON feed, "Free Food and Beverages" category.
  - DukeGroups: public iCal feed of student org events, scanned for food words (pizza, boba, "lunch provided", and more).
  - Instagram: club posts read through Meta's official Business Discovery API. Claude reads each caption and flyer image and pulls out the date, time, place, and food.
- Shows the next 7 days at your site, with a signup box.
- Sends a daily email at 6 AM EST / 7 AM EDT to confirmed subscribers.
- Gives the curator an admin page to add events, approve or hide flagged ones, preview the email, and send it by hand.
- Takes public tips at `/tip`. Tips wait for approval.
- Offers a calendar feed at `/events.ics`.

Auto-approved: Duke Calendar events, and DukeGroups events with a clear food phrase.
Sent to review: Instagram events, tips, and DukeGroups events with weak or paid signals ("dinner", "$25 tickets").

## How it runs

```
GitHub Actions (every 2h)  ──►  ingest/run.mjs  ──►  POST /api/ingest  ──►  Cloudflare Worker + D1
                                                                                │
                                              daily cron 11:00 UTC  ──►  Resend ──► subscribers
```

The ingest runs on GitHub Actions because the DukeGroups feed is about 3 MB, too heavy for the Workers free plan CPU limit.

## Setup (about 30 minutes)

You need: a Cloudflare account, a GitHub account, a Resend account with your domain verified.

1. Install and log in
   ```
   npm install
   npx wrangler login
   ```
2. Create the database. Copy the `database_id` it prints into `wrangler.toml`.
   ```
   npx wrangler d1 create dukebites
   npm run db:init
   ```
3. Edit `wrangler.toml`: set `SITE_URL` and `FROM_EMAIL`.
4. Add secrets
   ```
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put INGEST_TOKEN      # long random string, e.g. `openssl rand -hex 32`
   ```
5. Deploy: `npm run deploy`. Point a domain at it in the Cloudflare dashboard (Workers > your worker > Domains).
6. Push this folder to a GitHub repo. In Settings > Secrets and variables > Actions, add:
   - `WORKER_URL` (your site URL)
   - `INGEST_TOKEN` (same value as step 4)
7. Run the workflow once from the Actions tab ("Collect food events" > Run workflow). Check your site.

Admin page: `https://your-site/admin`. Username: anything. Password: `ADMIN_PASSWORD`.

## Instagram (optional)

Scraping Instagram breaks Meta's terms and gets blocked fast. This uses the official API instead.

1. Turn your own Instagram account (or a new Duke Bites account) into a Professional account and link it to a Facebook Page.
2. Create a Meta app at developers.facebook.com with Instagram API with Facebook Login. Get a long-lived user access token and your Instagram user ID.
3. Add GitHub secrets: `IG_USER_ID`, `IG_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`.
4. List club handles in `ingest/instagram-handles.json`.

Limits:
- Only Business or Creator accounts are readable. Personal accounts fail and show in the log. Ask clubs to switch, which is free.
- Long-lived tokens expire after about 60 days. Refresh them.
- Instagram events land in review first. Set `IG_AUTO_APPROVE=true` in the workflow to skip review.

## Costs

- Cloudflare Workers + D1: free tier.
- GitHub Actions: free for public repos. About 400 minutes a month for private repos, inside the 2,000 free minutes.
- Resend: free up to 100 emails a day. Past 100 subscribers you need Pro at $20 a month.
- Claude API (Instagram only): Haiku per post, small.

## Commands

```
npm test                         # unit tests for parsing, food matching, time zones
npm run dev                      # local server at localhost:8787 (put secrets in .dev.vars)
npm run ingest:dry               # fetch all sources and print, no upload
node ingest/run.mjs --sources dukegroups --dry-run
```

## Files

- `src/worker.js` routes: site, subscribe, confirm, unsubscribe, tip, admin, ingest API, cron
- `src/email.js` email template and Resend calls
- `src/html.js` page templates
- `ingest/run.mjs` collector entry point
- `ingest/sources/*.mjs` one file per source
- `ingest/food.mjs` food word matching
- `schema.sql` database tables
