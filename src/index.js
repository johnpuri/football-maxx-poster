/**
 * Main runner: fetch highlights (Highlightly → ScoreBat fallback → yt-dlp) → post via Zernio
 * Historical mode: RANDOM_HISTORICAL=1 or HISTORICAL_MODE=1 picks random 1998-2026 year/tournament/match.
 */
import "dotenv/config";
import { config } from "./config.js";
import { fetchHighlights, filterAndRank } from "./highlightly.js";
import { fetchScorebatHighlights, filterAndRankScorebat } from "./scorebat.js";
import { createFacebookPost } from "./zernio.js";
import { formatPost } from "./formatter.js";
import { getRandomHistoricalPick, finalToHighlight, pickRandomYear, TOURNAMENTS } from "./historical.js";
import fs from "fs";
import { execSync } from "child_process";

const POSTED_FILE = "./posted.json";

function loadPosted() {
  try { return new Set(JSON.parse(fs.readFileSync(POSTED_FILE, "utf8"))); } catch { return new Set(); }
}
function savePosted(set) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify([...set], null, 2));
}

async function getHighlights() {
  const historicalMode = process.env.RANDOM_HISTORICAL === "1" || process.env.RANDOM_HISTORICAL === "true" || process.env.HISTORICAL_MODE === "1" || process.env.HISTORICAL_MODE === "true";
  let historicPick = null;
  if (historicalMode) {
    historicPick = getRandomHistoricalPick();
    console.log(`[HISTORICAL MODE] Random pick: ${historicPick.tournament} ${historicPick.year} — ${historicPick.title} (query: "${historicPick.query}")`);
  }

  // Try Highlightly first if key present
  if (config.highlightlyKey) {
    try {
      console.log("Fetching from Highlightly...");
      const raw = await fetchHighlights({ limit: 20 });
      let ranked = filterAndRank(raw, config.maxHighlightsPerRun * 3);
      if (historicalMode && historicPick) {
        // Prefer highlights matching the historic year/tournament
        const filtered = ranked.filter(h =>
          (h.league && h.league.toLowerCase().includes(historicPick.tournament.toLowerCase())) ||
          (h.title && h.title.includes(String(historicPick.year)))
        );
        if (filtered.length) ranked = filtered;
      }
      if (ranked.length) return { highlights: ranked, historicPick };
      console.log("Highlightly returned 0, trying ScoreBat fallback...");
    } catch (e) {
      console.warn("Highlightly failed:", e.message, "→ falling back to ScoreBat");
    }
  } else {
    console.log("No HIGHLIGHTLY_RAPIDAPI_KEY, using ScoreBat directly");
  }
  try {
    const sb = await fetchScorebatHighlights({ token: config.scorebatToken, limit: 20 });
    let ranked = filterAndRankScorebat(sb, config.maxHighlightsPerRun * 3);
    if (historicalMode && historicPick) {
      const filtered = ranked.filter(h =>
        (h.league && h.league.toLowerCase().includes(historicPick.tournament.toLowerCase())) ||
        (h.title && h.title.includes(String(historicPick.year)))
      );
      if (filtered.length) ranked = filtered;
    }
    if (ranked.length) return { highlights: ranked, historicPick };
    console.warn("ScoreBat returned 0 results");
  } catch (e) {
    console.warn("ScoreBat also failed:", e.message);
  }
  // Historical yt-dlp fallback — synthesize highlight from notable final
  if (historicalMode && historicPick) {
    console.log(`Attempting yt-dlp fallback for: ${historicPick.query}`);
    const ytUrl = tryYtDlpSearch(historicPick.query);
    const base = historicPick.match ? finalToHighlight(historicPick.match, ytUrl) : {
      id: `historic-${Date.now()}`,
      title: historicPick.title,
      league: `${historicPick.tournament} ${historicPick.year}`,
      homeTeam: historicPick.match?.homeTeam || "",
      awayTeam: historicPick.match?.awayTeam || "",
      date: `${historicPick.year}-07-01`,
      videoUrl: ytUrl || "",
      embedUrl: ytUrl || "",
      thumbnail: "",
      source: "historical-yt-dlp",
      historic: true,
      year: historicPick.year,
      tournament: historicPick.tournament,
      query: historicPick.query,
    };
    // Ensure header year is correct — override league year if needed
    if (!base.league.includes(String(historicPick.year))) base.league = `${historicPick.tournament} ${historicPick.year}`;
    return { highlights: [base], historicPick };
  }
  if (config.highlightlyKey) throw new Error("No highlights available");
  console.warn("No highlights available - set HIGHLIGHTLY_RAPIDAPI_KEY (free 100/day) or SCOREBAT_TOKEN. See README.");
  return { highlights: [], historicPick };
}

function tryYtDlpSearch(query) {
  try {
    // yt-dlp ytsearch1 returns first result URL; --get-id prints video id
    const id = execSync(`yt-dlp "ytsearch1:${query}" --get-id --no-warnings 2>/dev/null | head -n1`, { timeout: 15000, encoding: "utf8" }).trim();
    if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  } catch {}
  return "";
}

async function main() {
  console.log(`Football Maxx Poster — dryRun=${config.dryRun}`);
  const posted = loadPosted();
  const { highlights, historicPick } = await getHighlights();
  if (historicPick) console.log(`Historical header: ${historicPick.tournament} ${historicPick.year}`);
  console.log(`Found ${highlights.length} highlights`);

  const fresh = highlights.filter((h) => !posted.has(h.id)).slice(0, config.maxHighlightsPerRun);
  if (!fresh.length) {
    console.log("No fresh highlights to post (all already posted or none found).");
    return;
  }
  console.log(`Posting ${fresh.length} fresh highlights...`);
  for (const h of fresh) {
    const content = formatPost(h);
    console.log("\n---");
    console.log(content);
    console.log("---");
    if (config.dryRun) {
      console.log(`[DRY RUN] Would post: ${h.title}`);
    } else {
      if (!config.zernioApiKey || !config.facebookAccountId) {
        console.warn("Skipping post - ZERNIO_API_KEY or FACEBOOK_ACCOUNT_ID missing. Set them in .env (see README).");
        console.log("[DRY RUN fallback] Not posted.");
        continue;
      }
      const result = await createFacebookPost({ content, publishNow: true });
      console.log("Posted:", JSON.stringify(result).slice(0, 300));
    }
    posted.add(h.id);
    savePosted(posted);
  }
  console.log("Done. Posted IDs saved to posted.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
