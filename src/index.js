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
import { isCartoonVideoSync, isCartoonVideo, pickFirstRealVideo } from "./cartoonFilter.js";
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
  // Filtered variant below is preferred; keep sync fallback for compat
  const url = tryYtDlpSearchFilteredSync(query);
  return url;
}

function tryYtDlpSearchFilteredSync(query) {
  try {
    // Fetch up to 5 candidates and skip cartoon/animated via keyword filter (sync)
    const out = execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`, { timeout: 20000, encoding: "utf8" }).trim();
    const lines = out.split("\n").filter(Boolean);
    // yt-dlp --get-id --get-title emits: title \n id \n title \n id ...
    // Actually with both flags it prints title then id per entry
    const candidates = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
      const title = lines[i];
      const id = lines[i + 1];
      if (/^[A-Za-z0-9_-]{6,}$/.test(id)) candidates.push({ id, title });
    }
    // If parsing didn't yield pairs, fall back to id-only
    if (!candidates.length) {
      const ids = out.split("\n").map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{6,}$/.test(s));
      for (const id of ids) candidates.push({ id, title: "" });
    }
    for (const c of candidates) {
      if (isCartoonVideoSync(c.title, "")) {
        console.log(`[cartoonFilter] skipping cartoon (keyword): ${c.id} — ${c.title}`);
        continue;
      }
      return `https://www.youtube.com/watch?v=${c.id}`;
    }
    // fallback: first id if all filtered (should not happen)
    if (candidates.length) return `https://www.youtube.com/watch?v=${candidates[0].id}`;
  } catch {}
  // Fallback to single search
  try {
    const id = execSync(`yt-dlp "ytsearch1:${query}" --get-id --no-warnings 2>/dev/null | head -n1`, { timeout: 15000, encoding: "utf8" }).trim();
    if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  } catch {}
  return "";
}

// Async version that also does Kimi WebBridge vision check on thumbnail (real match footage only)
export async function tryYtDlpSearchFiltered(query) {
  try {
    const out = execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`, { timeout: 20000, encoding: "utf8" }).trim();
    const lines = out.split("\n").filter(Boolean);
    const candidates = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
      const title = lines[i];
      const id = lines[i + 1];
      if (/^[A-Za-z0-9_-]{6,}$/.test(id)) candidates.push({ id, title, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` });
    }
    if (!candidates.length) {
      const ids = out.split("\n").map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{6,}$/.test(s));
      for (const id of ids) candidates.push({ id, title: "", thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` });
    }
    for (const c of candidates) {
      const isCartoon = await isCartoonVideo(c.title, "", c.thumbnail);
      if (isCartoon) {
        console.log(`[cartoonFilter] skipping cartoon (keyword+vision): ${c.id} — ${c.title}`);
        continue;
      }
      return `https://www.youtube.com/watch?v=${c.id}`;
    }
    if (candidates.length) return `https://www.youtube.com/watch?v=${candidates[0].id}`;
  } catch (e) {
    console.warn("tryYtDlpSearchFiltered failed:", e.message);
  }
  return tryYtDlpSearchFilteredSync(query);
}

async function main() {
  console.log(`Football Maxx Poster — dryRun=${config.dryRun}`);
  const posted = loadPosted();
  const { highlights, historicPick } = await getHighlights();
  if (historicPick) console.log(`Historical header: ${historicPick.tournament} ${historicPick.year}`);
  console.log(`Found ${highlights.length} highlights`);

  const fresh = highlights.filter((h) => !posted.has(h.id)).slice(0, config.maxHighlightsPerRun);
  // Cartoon filter: drop any highlight whose title/description looks cartoon/animated
  const filteredFresh = fresh.filter(h => {
    if (isCartoonVideoSync(h.title || "", h.description || h.league || "")) {
      console.log(`[cartoonFilter] skipping post (cartoon): ${h.title}`);
      return false;
    }
    return true;
  });
  const toPost = filteredFresh.length ? filteredFresh : [];
  if (!toPost.length) {
    console.log("No fresh highlights to post (all already posted or none found).");
    return;
  }
  console.log(`Posting ${fresh.length} fresh highlights...`);
  for (const h of toPost) {
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
