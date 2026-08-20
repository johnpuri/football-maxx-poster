# Football Maxx Poster ⚽

Automated football highlights poster for the **Football Maxx** Facebook Page.

- **Highlights source**: [Highlightly Football API](https://highlightly.net) via RapidAPI (950+ leagues) — **no YouTube API used**
- **Fallback**: [ScoreBat](https://www.scorebat.com/video-api/) (free)
- **Posting**: [Zernio API](https://docs.zernio.com/platforms/facebook) → Facebook Pages

Covers: FIFA World Cup, UEFA Euro, UEFA Champions League, Premier League, La Liga, Ligue 1, Serie A, Bundesliga, Copa America (+ 940 more via Highlightly).

## Setup

```bash
cp .env.example .env
# edit .env
npm install
```

### 1. Zernio — Facebook Page

1. Connect your Facebook Page at [zernio.com](https://zernio.com) (OAuth: Facebook).
2. Copy your API key — already in `.env` as `ZERNIO_API_KEY` (from Google Doc "Linux").
3. Find your Facebook `ACCOUNT_ID`:

```bash
node src/resolve.js
# copy the facebook accountId into .env → FACEBOOK_ACCOUNT_ID
```

Zernio docs: https://docs.zernio.com/platforms/facebook → `POST /api/v1/posts` with `platform: "facebook"`.

### 2. Highlightly (RapidAPI) — required for best coverage

1. Sign up at https://rapidapi.com/highlightly/api/highlightly
2. Subscribe (Free: 100 req/day).
3. Copy the **RapidAPI Key** (header `x-rapidapi-key`) into `.env`:

```
HIGHLIGHTLY_RAPIDAPI_KEY=your_rapidapi_key_here
```

Endpoints used: `/highlights`, `/matches` (filtered by priority leagues). Without this key the app automatically falls back to ScoreBat.

### 3. ScoreBat fallback (optional)

Free no-key feed at `https://www.scorebat.com/video-api/v3/feed/`. For higher limits get a token at https://www.scorebat.com/video-api/ and set `SCOREBAT_TOKEN`.

## Usage

```bash
# Dry run - fetch highlights and print post preview (no posting)
npm run dry-run
# or
DRY_RUN=true node src/index.js

# Real post to Facebook via Zernio
npm start

# Resolve Facebook account ID
node src/resolve.js
```

**Deduplication**: posted highlight IDs are stored in `posted.json` (gitignored) to avoid reposting.

**Scheduling**: run via cron every 6 hours (configurable `POST_INTERVAL_HOURS`):

```cron
0 */6 * * * cd ~/dev/football-maxx-poster && npm start >> poster.log 2>&1
```

Or use Hermes cron or GitHub Actions.

## How it works

```
Highlightly /highlights (950+ leagues)
        ↓ (if fails or no key)
     ScoreBat /video-api/v3/feed
        ↓
  filter + rank by priority leagues
        ↓
  formatPost() → Facebook copy + video link + hashtags
        ↓
  Zernio POST /api/v1/posts → Facebook Page
```

No YouTube API is used anywhere.

## Env vars

| Var | Required | Notes |
|-----|----------|-------|
| `ZERNIO_API_KEY` | yes for posting | `sk_71627a...` |
| `FACEBOOK_ACCOUNT_ID` | yes for posting | from `node src/resolve.js` |
| `HIGHLIGHTLY_RAPIDAPI_KEY` | recommended | RapidAPI key, free 100/day |
| `SCOREBAT_TOKEN` | no | fallback only |

## License

MIT

## Copyright & Accuracy Safeguards (2026-08-20)

- Do NOT post copyrighted official broadcast without permission. Always check `yt-dlp --dump-json` fields: `uploader`, `license`, `upload_date`.
- Official league channels (Serie A, UEFA, LaLiga, Premier League, FIFA TV) are high copyright risk — will show "not available" / takedown on Facebook. Avoid unless VERIFIED.
- Prefer Highlightly sources with `verified: true` (Highlightly VERIFIED flag) or ScoreBat free-feed that explicitly allows redistribution. Filter: `highlight.verified === true` before posting.
- For YouTube fallback: use fan highlights / public domain, check license, prefer Creative Commons. Skip videos where `uploader` is official broadcaster and `license` is not Creative Commons.
- Accuracy: always verify `title`, `upload_date`, `duration` via `yt-dlp --dump-json` before building caption. Example 2026-08-20: Serie A video `7YyOTvPR950` title is `MILAN-INTER | HIGHLIGHTS | Tight Clash in Milan Derby | Serie A 2025/26` (uploaded 20260308, 155s) — not 2005. Corrected to `Serie A 2025/26 Derby — AC Milan vs Inter Milan`.
- Enforcement: `src/highlightly.js` should filter VERIFIED only; `src/index.js` should skip non-verified official sources. See Zernio unpublish: `POST /v1/posts/{id}/unpublish {platform:"facebook"}` for takedowns (DELETE returns 400 for published).
