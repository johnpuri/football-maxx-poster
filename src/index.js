/**
 * Main runner: fetch highlights (Highlightly → ScoreBat fallback → yt-dlp) → post via Zernio
 * Historical mode: RANDOM_HISTORICAL=1 or HISTORICAL_MODE=1 picks random 1998-2026 year/tournament/match.
 */
import "dotenv/config";
import { config } from "./config.js";
import { fetchHighlights, filterAndRank } from "./highlightly.js";
import { fetchScorebatHighlights, filterAndRankScorebat } from "./scorebat.js";
import { createFacebookPost, extractPostId, verifyPostPublished, isPostVerified, containsFacebookError, presignUploadStrict, validateMediaUrlsStrict, getPost, deletePost, unpublishPost, listPosts, cleanupEmptyPosts } from "./zernio.js";
import { formatPost } from "./formatter.js";
import { getRandomHistoricalPick, finalToHighlight, pickRandomYear, TOURNAMENTS } from "./historical.js";
import { isCartoonVideoSync, isCartoonVideo, pickFirstRealVideo } from "./cartoonFilter.js";
import { isFifaHighRisk } from "./validate.js";
import { validateHighlight, pickValidHighlightFromCandidates } from "./validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./ytParser.js";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { applyDynamicWatermark } from "./watermark.js";

export function getYtDlpCookiesFlag() {
  const cookiePath = "/tmp/youtube_cookies.txt";
  if (fs.existsSync(cookiePath) && fs.statSync(cookiePath).size > 100) {
    return `--cookies "${cookiePath}"`;
  }
  return "";
}

export function refreshCookiesIfNeeded(force = false) {
  const cookiePath = "/tmp/youtube_cookies.txt";
  let needsRefresh = force || !fs.existsSync(cookiePath);
  if (!needsRefresh) {
    try {
      const st = fs.statSync(cookiePath);
      if (st.size < 100 || (Date.now() - st.mtimeMs > 6 * 3600 * 1000)) {
        needsRefresh = true;
      }
    } catch {
      needsRefresh = true;
    }
  }
  if (needsRefresh) {
    try {
      console.log("[cookies] Refreshing /tmp/youtube_cookies.txt via get_cookies.mjs...");
      execSync("node get_cookies.mjs", { timeout: 45000, cwd: "/home/john/dev/football-maxx-poster" });
    } catch (e) {
      console.warn("[cookies] Failed to refresh cookies:", e.message);
    }
  }
  return getYtDlpCookiesFlag();
}

export function pickCachedFallbackReel(postedSet = new Set()) {
  let files = [];
  try {
    files = fs.readdirSync("/tmp")
      .filter(f => f.startsWith("wm_") && f.endsWith(".mp4"))
      .map(f => path.join("/tmp", f))
      .filter(p => {
        try { return fs.statSync(p).size > 1_000_000; } catch { return false; }
      });
  } catch {}
  if (!files.length) return null;

  const candidates = [];
  const allParsed = [];
  for (const fp of files) {
    const base = path.basename(fp);
    const m = base.replace(/^wm_historic-/, "").replace(/\.mp4$/, "").match(/^(.+)-(\d{4})-(.+)-vs-(.+)$/);
    if (!m) continue;
    const tc = s => s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const tournament = tc(m[1]);
    const year = parseInt(m[2], 10);
    const homeTeam = tc(m[3]);
    const awayTeam = tc(m[4]);
    const highlight = {
      id: `historic-${m[1]}-${year}-${m[3]}-vs-${m[4]}`,
      title: `${tournament} ${year} — ${homeTeam} vs ${awayTeam}`,
      tournament,
      year,
      league: `${tournament} ${year}`,
      homeTeam,
      awayTeam,
      stage: "Highlights",
      date: `${year}-07-01`,
      isCachedWm: true,
      source: "cached-wm-fallback",
    };
    allParsed.push({ path: fp, highlight, base });
    if (postedSet.has(base) || postedSet.has(fp) || isAlreadyPosted(highlight, postedSet)) {
      continue;
    }
    candidates.push({ path: fp, highlight, base });
  }

  // ffprobe gate: cached file must be a valid video, 60-250s (same bar as fresh downloads)
  const validParsed = [];
  for (const cand of allParsed) {
    try {
      const dur = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${cand.path}" 2>&1`, { encoding: "utf8", timeout: 10000 }).trim();
      const d = parseFloat(dur);
      const vs = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${cand.path}" 2>&1`, { encoding: "utf8", timeout: 10000 }).trim();
      if (vs.includes("video") && d >= 60 && d <= 250) validParsed.push(cand);
      else console.warn(`[cached fallback] skipping invalid cached file: ${cand.base} (dur=${dur}, stream=${vs})`);
    } catch { console.warn(`[cached fallback] skipping unreadable cached file: ${cand.base}`); }
  }
  const validCandidates = candidates.filter(c => validParsed.includes(c));
  if (!validCandidates.length) {
    // NO repost: every valid cached reel already posted → fail clean so cron logs it instead of duplicating
    console.warn("[cached fallback] All valid cached reels already posted — refusing to repost (no duplicate).");
    return null;
  }
  validCandidates.sort(() => Math.random() - 0.5);
  return validCandidates[0];
}

async function deduplicateRecentPosts() {
  try {
    const recent = await listPosts(5);
    const seen = new Map();
    for (const post of recent) {
      const mediaUrl = post.mediaItems?.[0]?.url;
      if (!mediaUrl) continue;
      const base = mediaUrl.split("/").pop().replace(/^\d+_[a-z0-9]+_/, "");
      if (seen.has(base)) {
        const olderId = post._id || post.id;
        console.log(`[dedup] Duplicate detected for ${base}: unpublishing older post ${olderId}`);
        const un = await unpublishPost(olderId);
        console.log(`[dedup] unpublish ${olderId} => ${un.status}`);
      } else {
        seen.set(base, post._id || post.id);
      }
    }
  } catch (e) {
    console.warn(`[dedup] deduplicateRecentPosts failed: ${e.message}`);
  }
}

const POSTED_FILE = "./posted.json";
const POSTED_FILE_SRC = "./src/posted.json";
const POSTED_FILE_TMP = "/tmp/posted_set.json";

function loadPosted() {
  const set = new Set();
  for (const p of [POSTED_FILE, POSTED_FILE_SRC, POSTED_FILE_TMP]) {
    try { for (const k of JSON.parse(fs.readFileSync(p, "utf8"))) set.add(k); } catch {}
  }
  return set;
}
function savePosted(set) {
  const arr = [...set].sort();
  for (const p of [POSTED_FILE, POSTED_FILE_SRC, POSTED_FILE_TMP]) {
    try { fs.writeFileSync(p, JSON.stringify(arr, null, 2)); } catch {}
  }
}
function normalizeTeam(s){
  return (s||"").toLowerCase()
    .replace(/\b(uefa|fifa|euro|european|world|champions|league|cup|copa|america|ucl|epl|laliga|premier|bundesliga|serie|ligue|europa|final|semi|quarter|round|group|stage|regular|season|knockout|playoff|highlights?)\b/g," ")
    .replace(/(19|20)\d{2}/g," ")
    .replace(/[^a-z0-9]/g,"");
}
export function highlightPostedKeys(h){
  const keys=[];
  if(h.id) keys.push(h.id);
  const year = h.year || (h.date? String(new Date(h.date).getFullYear()): "") || (h.league?.match(/\b(19|20)\d{2}\b/)?.[0]||"");
  const tourn = (h.tournament||h.league||"").toString();
  const tNorm = tourn.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9\-]/g,"");
  const ht = normalizeTeam(h.homeTeam||"");
  const at = normalizeTeam(h.awayTeam||"");
  if(ht && at && year){
    keys.push(`${ht}_vs_${at}_${year}_${tNorm}`);
    keys.push(`${at}_vs_${ht}_${year}_${tNorm}`);
    keys.push(`${ht}_vs_${at}_${year}`);
    keys.push(`${at}_vs_${ht}_${year}`);
    keys.push(`historic-${tNorm}-${year}-${ht}-vs-${at}`);
    keys.push(`historic-${tNorm}-${year}-${at}-vs-${ht}`);
  }
  return keys;
}
export function isAlreadyPosted(h, postedSet){
  if(postedSet.has(h.id)) return true;
  for(const k of highlightPostedKeys(h)) if(postedSet.has(k)) return true;
  return false;
}

async function getHighlights() {
  const historicalMode = process.env.RANDOM_HISTORICAL === "1" || process.env.RANDOM_HISTORICAL === "true" || process.env.HISTORICAL_MODE === "1" || process.env.HISTORICAL_MODE === "true";
  let historicPick = null;
  if (historicalMode) {
    historicPick = getRandomHistoricalPick();
    // FIFA safeguard: if somehow a WC Final slipped through, re-roll (up to 5 tries)
    let rerolls=0;
    while (historicPick && /world cup/i.test(historicPick.tournament) && /final/i.test(historicPick.title) && rerolls<5){
      console.log(`[FIFA SAFEGUARD] Re-rolling banned WC Final pick: ${historicPick.title} → picking club game instead`);
      historicPick = getRandomHistoricalPick();
      rerolls++;
    }
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
    // Patch historical match object to ensure yt-dlp source + query are set correctly
    if (historicPick.match) {
      base.query = historicPick.query;
      base.source = "historical-yt-dlp";
      base.year = base.year || historicPick.year;
      base.tournament = base.tournament || historicPick.tournament;
      if (!base.league) base.league = `${historicPick.tournament} ${historicPick.year}`;
    }
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

// --- High-liked filtering: dump-json + sort by view_count/like_count ---
function parseYtDlpJsonOutput(out) {
  const candidates = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const j = JSON.parse(trimmed);
      if (!j.id) continue;
      candidates.push({
        id: j.id,
        title: j.title || j.fulltitle || "",
        view_count: j.view_count ?? j.viewCount ?? 0,
        like_count: j.like_count ?? j.likeCount ?? 0,
        comment_count: j.comment_count ?? j.commentCount ?? 0,
        uploader: j.uploader || j.uploader_id || j.channel || "",
        thumbnail: j.thumbnail || `https://img.youtube.com/vi/${j.id}/hqdefault.jpg`,
        _raw: j,
      });
    } catch {}
  }
  return candidates;
}
function filterAndSortByPopularity(candidates) {
  // Filter: skip low-view shit (<10k views) and require high engagement
  const highQuality = candidates.filter(c => {
    const vc = c.view_count || 0;
    const lc = c.like_count || 0;
    const cc = c.comment_count || 0;
    // Primary: must have at least 10k views to not be shit
    if (vc < 10000) return false;
    // Secondary: highlight high-liked = view_count>50000 OR like_count>1000 OR comment_count>200
    return vc > 50000 || lc > 1000 || cc > 200;
  });
  const pool = highQuality.length ? highQuality : candidates.filter(c => (c.view_count||0) >= 10000);
  const sortPool = pool.length ? pool : candidates;
  // Sort by view_count descending, then like_count descending, then comment_count
  sortPool.sort((a,b) => {
    if ((b.view_count||0) !== (a.view_count||0)) return (b.view_count||0) - (a.view_count||0);
    if ((b.like_count||0) !== (a.like_count||0)) return (b.like_count||0) - (a.like_count||0);
    return (b.comment_count||0) - (a.comment_count||0);
  });
  // Log filtering
  if (candidates.length && sortPool.length) {
    console.log(`[yt-dlp] ${candidates.length} candidates → ${pool.length ? pool.length+' high-quality' : 'fallback'} → top view=${sortPool[0].view_count} likes=${sortPool[0].like_count} "${sortPool[0].title.slice(0,60)}"`);
  }
  return sortPool;
}
function getCandidatesViaDumpJson(query, count=10) {
  try {
    let cookiesFlag = refreshCookiesIfNeeded();
    let out = "";
    try {
      out = execSync(`yt-dlp ${cookiesFlag} "ytsearch${count}:${query}" --dump-json --no-warnings 2>/dev/null`, { timeout: 60000, encoding: "utf8", maxBuffer: 15*1024*1024 }).trim();
    } catch {
      // Retry once with refreshed cookies
      cookiesFlag = refreshCookiesIfNeeded(true);
      out = execSync(`yt-dlp ${cookiesFlag} "ytsearch${count}:${query}" --dump-json --no-warnings 2>/dev/null`, { timeout: 60000, encoding: "utf8", maxBuffer: 15*1024*1024 }).trim();
    }
    if (!out) return [];
    const cands = parseYtDlpJsonOutput(out);
    if (cands.length) return filterAndSortByPopularity(cands);
  } catch (e) {
    console.warn(`[yt-dlp] dump-json failed for "${query}": ${e.message?.slice(0,200)}`);
  }
  return [];
}

function tryYtDlpSearchFilteredSync(query) {
  // Try high-liked dump-json path (ytsearch10 sorted by view_count)
  const sorted = getCandidatesViaDumpJson(query, 10);
  if (sorted.length) {
    for (const c of sorted) {
      if (isCartoonVideoSync(c.title, "")) {
        console.log(`[cartoonFilter] skipping cartoon (keyword): ${c.id} — ${c.title} (views=${c.view_count})`);
        continue;
      }
      return `https://www.youtube.com/watch?v=${c.id}`;
    }
    // all were cartoon, fallback to top non-cartoon check failed — return top
    return `https://www.youtube.com/watch?v=${sorted[0].id}`;
  }
  // Fallback to old --get-id --get-title path (no view metadata)
  const cookiesFlag = getYtDlpCookiesFlag();
  try {
    const out = execSync(`yt-dlp ${cookiesFlag} "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`, { timeout: 20000, encoding: "utf8" }).trim();
    const lines = out.split("\n").filter(Boolean);
    const candidates = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
      const title = lines[i];
      const id = lines[i + 1];
      if (/^[A-Za-z0-9_-]{6,}$/.test(id)) candidates.push({ id, title, view_count: 0, like_count: 0 });
    }
    if (!candidates.length) {
      const ids = out.split("\n").map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{6,}$/.test(s));
      for (const id of ids) candidates.push({ id, title: "", view_count: 0, like_count: 0 });
    }
    for (const c of candidates) {
      if (isCartoonVideoSync(c.title, "")) {
        console.log(`[cartoonFilter] skipping cartoon (keyword): ${c.id} — ${c.title}`);
        continue;
      }
      return `https://www.youtube.com/watch?v=${c.id}`;
    }
    if (candidates.length) return `https://www.youtube.com/watch?v=${candidates[0].id}`;
  } catch {}
  try {
    const id = execSync(`yt-dlp ${cookiesFlag} "ytsearch1:${query}" --get-id --no-warnings 2>/dev/null | head -n1`, { timeout: 15000, encoding: "utf8" }).trim();
    if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  } catch {}
  return "";
}

async function downloadVideoFile(videoUrl, id) {
  if (!videoUrl || !/^https?:\/\//.test(videoUrl)) return null;
  const outPath = `/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`;
  const cookiesFlag = refreshCookiesIfNeeded();
  try {
    console.log(`[video] Downloading for reel: ${videoUrl} → ${outPath}`);
    execSync(`yt-dlp ${cookiesFlag} -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${outPath}" "${videoUrl}" 2>&1 | tail -n 5`, { timeout: 120000, encoding: "utf8" });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      console.log(`[video] Downloaded: ${outPath} (${Math.round(fs.statSync(outPath).size/1024/1024)}MB)`);
      return outPath;
    }
    console.warn(`[video] Download failed or too small: ${outPath}`);
  } catch (e) {
    console.warn(`[video] Download error: ${e.message?.slice(0,300)}`);
  }
  return null;
}

// Async version that also does Kimi WebBridge vision check on thumbnail (real match footage only) — high-liked sorted
export async function tryYtDlpSearchFiltered(query) {
  const sorted = getCandidatesViaDumpJson(query, 10);
  if (sorted.length) {
    for (const c of sorted) {
      const isCartoon = await isCartoonVideo(c.title, "", c.thumbnail);
      if (isCartoon) {
        console.log(`[cartoonFilter] skipping cartoon (keyword+vision): ${c.id} — ${c.title} (views=${c.view_count})`);
        continue;
      }
      return `https://www.youtube.com/watch?v=${c.id}`;
    }
    return `https://www.youtube.com/watch?v=${sorted[0].id}`;
  }
  // Fallback to old path
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
    console.warn("tryYtDlpSearchFiltered fallback failed:", e.message);
  }
  return tryYtDlpSearchFilteredSync(query);
}

async function main() {
  console.log(`Football Maxx Poster — dryRun=${config.dryRun}`);
  const posted = loadPosted();
  let { highlights, historicPick } = await getHighlights();
  if (historicPick) console.log(`Historical header: ${historicPick.tournament} ${historicPick.year}`);
  console.log(`Found ${highlights.length} highlights`);

  const historicalMode = process.env.RANDOM_HISTORICAL === "1" || process.env.RANDOM_HISTORICAL === "true" || process.env.HISTORICAL_MODE === "1" || process.env.HISTORICAL_MODE === "true";
  const freshRaw = highlights.filter((h) => !isAlreadyPosted(h, posted));
  // For historical yt-dlp fallback, allow re-post with different stage/query if filtered as duplicate (stage diversity requirement)
  let fresh = freshRaw.slice(0, config.maxHighlightsPerRun * 3);
  if (!fresh.length && historicalMode && highlights.length && historicPick) {
    // All flagged posted → re-roll NEW picks for different matches (never repost the same one)
    let reroll = null;
    for (let i = 0; i < 10; i++) {
      const p = getRandomHistoricalPick();
      const test = p.match ? finalToHighlight(p.match, "") : { id: `historic-${Date.now()}`, title: p.title, league: `${p.tournament} ${p.year}`, homeTeam: p.match?.homeTeam || "", awayTeam: p.match?.awayTeam || "", year: p.year, tournament: p.tournament };
      if (!isAlreadyPosted(test, posted)) { reroll = p; break; }
    }
    if (reroll) {
      console.log(`[HISTORICAL MODE] Re-rolled fresh pick: ${reroll.tournament} ${reroll.year} — ${reroll.title}`);
      historicPick = reroll;
      const base = reroll.match ? finalToHighlight(reroll.match, highlights[0]?.videoUrl || highlights[0]?.embedUrl || "") : highlights[0];
      fresh = [{ ...base, query: reroll.query, year: reroll.year, tournament: reroll.tournament, source: "historical-yt-dlp" }];
    } else {
      console.log(`[HISTORICAL MODE] No fresh match found after 10 re-rolls — skipping run (no duplicate).`);
      fresh = [];
    }
  } else {
    fresh = freshRaw.slice(0, config.maxHighlightsPerRun * 3);
  }
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
  for (let idx = 0; idx < toPost.length; idx++) {
    let h = toPost[idx];
    const content = formatPost(h);
    // SAFETY: never allow youtube link in content (video reel only)
    if (/youtube\.com|youtu\.be/i.test(content)) {
      console.warn(`[SAFETY] Skipping post with YouTube link in content: ${h.title}`);
      continue;
    }
    console.log("\n---");
    console.log(content);
    console.log("---");

    // Dry-run: validate metadata without requiring video file download
    if (config.dryRun) {
      // For yt-dlp sourced highlights with multiple candidates, iterate 1-5 until valid (metadata only)
      if ((h.source === "historical-yt-dlp" || h.source === "historical" || h.source?.startsWith("historical")) && h.query) {
        // In dry-run, validate without downloading — skip video file check
        const dryResult = await validateHighlight(h, { skipVideoCheck: true });
        if (!dryResult.valid) {
          console.log(`[DRY RUN][validate] Initial candidate failed: ${dryResult.reason} — trying next ytsearch candidates 1-5...`);
          // Try to find next valid candidate via ytsearch iteration (metadata-only, no download)
          const { execSync: _exec } = await import("child_process");
          try {
            // Use dump-json for high-liked sorting
            let cands = [];
            const cFlag = getYtDlpCookiesFlag();
            try {
              const jout = _exec(`yt-dlp ${cFlag} "ytsearch10:${h.query}" --dump-json --no-warnings 2>/dev/null`, { timeout: 30000, encoding: "utf8", maxBuffer: 15*1024*1024 }).trim();
              for (const line of jout.split("\n").filter(Boolean)) {
                if (!line.trim().startsWith("{")) continue;
                try { const j=JSON.parse(line); if(j.id) cands.push({ id:j.id, title:j.title||"", thumbnail:j.thumbnail||`https://img.youtube.com/vi/${j.id}/hqdefault.jpg`, view_count:j.view_count||0, like_count:j.like_count||0, comment_count:j.comment_count||0 }); } catch {}
              }
              cands.sort((a,b)=>(b.view_count||0)-(a.view_count||0)||(b.like_count||0)-(a.like_count||0));
              const hi=cands.filter(c=>(c.view_count||0)>=10000 && ((c.view_count>50000)||(c.like_count>1000)||(c.comment_count>200)));
              const pool=hi.length?hi:cands.filter(c=>(c.view_count||0)>=10000);
              cands=pool.length?pool:cands;
            } catch {}
            if (!cands.length) {
              const out = _exec(`yt-dlp ${cFlag} "ytsearch5:${h.query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`, { timeout: 20000, encoding: "utf8" }).trim();
              const lines = out.split("\n").filter(Boolean);
              for (let i = 0; i < lines.length - 1; i += 2) {
                const title = lines[i]; const id = lines[i+1];
                if (/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({ id, title, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, view_count:0, like_count:0 });
              }
            }
            let found = false;
            for (const c of cands) {
              const candH = { ...h, title: c.title, videoUrl: `https://www.youtube.com/watch?v=${c.id}`, embedUrl: `https://www.youtube.com/watch?v=${c.id}`, thumbnail: c.thumbnail };
              const r = await validateHighlight(candH, { skipVideoCheck: true });
              if (r.valid) {
                console.log(`[DRY RUN][validate] ✓ Found valid candidate: ${c.title} (${c.id})`);
                h = candH; found = true; break;
              } else {
                console.log(`[DRY RUN][validate] ✗ Candidate ${c.id} failed: ${r.reason}`);
              }
            }
            if (!found) { console.warn(`[DRY RUN][validate] No valid candidate found for query "${h.query}" — skipping`); continue; }
          } catch (e) { console.warn(`[DRY RUN] ytsearch iteration failed: ${e.message}`); continue; }
        } else {
          console.log(`[DRY RUN][validate] ✓ Highlight valid: ${dryResult.reason}`);
        }
      } else {
        const dryResult = await validateHighlight(h, { skipVideoCheck: true });
        if (!dryResult.valid) { console.warn(`[DRY RUN][validate] Skipping invalid highlight: ${dryResult.reason}`); continue; }
        console.log(`[DRY RUN][validate] ✓ Highlight valid: ${dryResult.reason}`);
      }
      console.log(`[DRY RUN] Would post (video reel only): ${h.title}`);
      if (h.videoUrl || h.embedUrl) console.log(`[DRY RUN] videoUrl present but NOT added to content — would download video file for reel: ${h.videoUrl || h.embedUrl}`);
      posted.add(h.id);
      for(const k of highlightPostedKeys(h)) posted.add(k);
      savePosted(posted);
      continue;
    }

    if (!config.zernioApiKey || !config.facebookAccountId) {
      console.warn("Skipping post - ZERNIO_API_KEY or FACEBOOK_ACCOUNT_ID missing. Set them in .env (see README).");
      console.log("[DRY RUN fallback] Not posted.");
      continue;
    }

    // VIDEO REEL ONLY: require local video file, never post YouTube link
    let mediaUrls = h.mediaUrls || h.mediaFiles || [];
    let localVideoPath = h.localVideoPath || null;
    const videoLink = h.videoUrl || h.embedUrl || "";

    // For historical yt-dlp highlights: iterate ytsearch 1-5 until valid before presign upload
    if (!mediaUrls.length && !localVideoPath && videoLink && (h.source === "historical-yt-dlp" || h.source === "historical" || h.source?.startsWith("historical")) && h.query) {
      console.log(`[validate] Historical highlight — iterating ytsearch candidates 1-5 for valid video before presign upload...`);
      const picked = await pickValidHighlightFromCandidates(h.query, h, downloadVideoFile);
      if (picked) {
        h = picked.highlight;
        localVideoPath = picked.videoPath;
        mediaUrls = [localVideoPath];
        console.log(`[validate] Using validated candidate: ${h.title} → ${localVideoPath}`);
      } else {
        console.warn(`[validate] No valid candidate found for "${h.query}" — skipping highlight`);
        continue;
      }
    } else if (!mediaUrls.length && videoLink) {
      const downloaded = await downloadVideoFile(videoLink, h.id);
      if (downloaded) { localVideoPath = downloaded; mediaUrls = [downloaded]; }
    }
    if (!mediaUrls.length && localVideoPath) mediaUrls = [localVideoPath];
    if (!mediaUrls.length) {
      console.warn(`[VIDEO REEL ONLY] Skipping ${h.title} — no video file available (YouTube links are not posted). Need local video file.`);
      console.log(`[cached fallback] Attempting to pick cached watermarked reel from /tmp/wm_*.mp4...`);
      const fallback = pickCachedFallbackReel(posted);
      if (fallback) {
        console.log(`[cached fallback] ✓ Picked cached reel: ${fallback.path} (${fallback.highlight.title})`);
        h = fallback.highlight;
        localVideoPath = fallback.path;
        mediaUrls = [fallback.path];
      } else {
        console.warn(`[VIDEO REEL ONLY] No cached fallback reel available either — skipping`);
        continue;
      }
    }

    // === Logo mandatory check before presign: requireTournamentLogo must succeed and PNG valid, else skip candidate ===
    {
      const { requireTournamentLogo } = await import("./config.js");
      const tourn = h.tournament || h.league || "";
      const yr = h.year || (h.date ? new Date(h.date).getFullYear() : null);
      try {
        const lp = requireTournamentLogo(tourn, yr);
        if (!fs.existsSync(lp)) throw new Error(`logo file missing ${lp}`);
        const buf = fs.readFileSync(lp);
        if (!(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47 && buf.length>=500)) throw new Error(`invalid PNG logo ${lp}`);
      } catch(e){
        console.warn(`[logo] Skipping ${h.title} — logo check failed for ${tourn} ${yr}: ${e.message}`);
        if (h.query) {
          const picked = await pickValidHighlightFromCandidates(h.query, h, downloadVideoFile);
          if (picked) { h = picked.highlight; localVideoPath = picked.videoPath; mediaUrls=[localVideoPath]; }
          else continue;
        } else continue;
      }
    }
    // === Validation before presign upload ===
    const vResult = await validateHighlight(h, { localVideoPath: localVideoPath || mediaUrls[0] });
    if (!vResult.valid) {
      console.warn(`[validate] Skipping invalid highlight before presign upload: ${vResult.reason}`);
      // If ytsearch candidates available and not already iterated, try next candidates
      if (h.query) {
        console.log(`[validate] Trying next candidates for "${h.query}"...`);
        const picked = await pickValidHighlightFromCandidates(h.query, h, downloadVideoFile);
        if (picked) {
          h = picked.highlight;
          localVideoPath = picked.videoPath;
          mediaUrls = [localVideoPath];
          const retry = await validateHighlight(h, { localVideoPath });
          if (!retry.valid) { console.warn(`[validate] Retry also failed: ${retry.reason} — skipping`); continue; }
          console.log(`[validate] Retry valid: ${h.title}`);
        } else { console.warn(`[validate] No valid candidate after retry — skipping`); continue; }
      } else {
        continue;
      }
    }
    console.log(`[validate] ✓ Highlight passed validation: ${h.title}`);

    // === STRICT PRE-PUBLISH: watermark HIGH UP (extended canvas above video) + presign upload with size>1M + PUT 200 + https://media.zernio.com ===
    let strictMediaUrl;
    try {
      let fileForUpload = localVideoPath || mediaUrls[0];
      if (!fileForUpload || !fs.existsSync(fileForUpload)) throw new Error(`no local video file for strict upload: ${fileForUpload}`);
      let sz = fs.statSync(fileForUpload).size;
      if (sz < 1_000_000) throw new Error(`video file too small ${sz} < 1M`);
      if (!h.isCachedWm && !path.basename(fileForUpload).startsWith("wm_")) {
        // Watermark: extended canvas 110px above video, logo mandatory, profile pic top-right
        const { requireTournamentLogo } = await import("./config.js");
        const tourn = h.tournament || h.league || "";
        const yr = h.year || (h.date ? new Date(h.date).getFullYear() : 2024);
        const logoPath = requireTournamentLogo(tourn, yr);
        let profilePic = "/tmp/page_profile.jpg";
        if (!fs.existsSync(profilePic) || fs.statSync(profilePic).size < 1000) {
          try { execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${profilePic}" 2>/dev/null`, {timeout:10000}); } catch {}
        }
        const watermarked = `/tmp/wm_${String(h.id).replace(/[^a-zA-Z0-9_-]/g,"_")}.mp4`;
        console.log(`[watermark] Applying HIGH UP bar 110px + logo ${logoPath} to ${fileForUpload} → ${watermarked}`);
        applyDynamicWatermark(fileForUpload, {
          tournament: tourn || "Football", year: yr, teamA: h.homeTeam||"Team A", teamB: h.awayTeam||"Team B", stage: h.stage||h.match?.stage||"Highlights",
          logoPath, watermarkPath: profilePic, output: watermarked, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false,
        });
        fileForUpload = watermarked;
        // Update localVideoPath to watermarked for later validation checks
        localVideoPath = watermarked;
      } else {
        console.log(`[watermark] Video is already watermarked: ${fileForUpload}`);
      }
      sz = fs.statSync(fileForUpload).size;
      console.log(`[strict] Presigning upload for watermarked ${fileForUpload} (${Math.round(sz/1024/1024)}MB)...`);
      strictMediaUrl = await presignUploadStrict(fileForUpload);
      console.log(`[strict] ✓ Upload OK: ${strictMediaUrl}`);
      if (!strictMediaUrl.startsWith("https://media.zernio.com")) throw new Error(`mediaUrl not https://media.zernio.com: ${strictMediaUrl}`);
      validateMediaUrlsStrict([strictMediaUrl]);
      // Remove any path where mediaUrls could be empty — from here on only strictMediaUrl is used
      mediaUrls = [strictMediaUrl];
    } catch (e) {
      console.warn(`[strict] Pre-publish upload FAILED for ${h.title}: ${e.message} — blacklisting and trying next candidate`);
      // blacklist this candidate
      posted.add(h.id);
      for (const k of highlightPostedKeys(h)) posted.add(k);
      savePosted(posted);
      // try next candidate via pickValidHighlight if available
      if (h.query) {
        const picked = await pickValidHighlightFromCandidates(h.query, h, downloadVideoFile);
        if (picked) {
          h = picked.highlight;
          localVideoPath = picked.videoPath;
          try {
            strictMediaUrl = await presignUploadStrict(localVideoPath);
            mediaUrls = [strictMediaUrl];
            console.log(`[strict] Retry upload OK: ${strictMediaUrl}`);
          } catch (e2) { console.warn(`[strict] Retry upload also failed: ${e2.message} — skipping`); continue; }
        } else continue;
      } else continue;
    }

    // --- Post with verification + retry (max 5 retries, strict post-publish check) ---
    let postVerified = false;
    let postResult = null;
    let postId = null;
    let verifyRetries = 6; // poll GET /posts/{id} up to 7 times (30s total for video processing)
    const MAX_POST_RETRIES = 5;
    let retryCount = 0;
    // current highlight pointer stays as h; on failure consume next candidate from toPost array
    let currentIdx = idx;
    // we need mutable reference to highlight for retries
    let candidate = h;
    let candidateMediaUrls = [strictMediaUrl]; // strictly validated only
    let candidateLocalPath = localVideoPath;
    const blacklisted = new Set();

    while (retryCount <= MAX_POST_RETRIES) {
      try {
        const contentToPost = formatPost(candidate);
        if (/youtube\.com|youtu\.be/i.test(contentToPost)) {
          console.warn(`[SAFETY] Skipping post with YouTube link in content: ${candidate.title}`);
          throw new Error("YouTube link in content");
        }
        // STRICT: re-validate mediaUrls before every POST — no empty path
        validateMediaUrlsStrict(candidateMediaUrls);
        if (!candidateMediaUrls[0].startsWith("https://media.zernio.com")) throw new Error("mediaUrl not https://media.zernio.com");
        postResult = await createFacebookPost({ content: contentToPost, mediaUrls: candidateMediaUrls, publishNow: true });
        const payloadStr = JSON.stringify(postResult);
        if (containsFacebookError(payloadStr) && /moved|rejected|blocked/i.test(payloadStr)) {
          throw new Error(`Facebook error in createPost response: ${payloadStr.slice(0,500)}`);
        }
        postId = extractPostId(postResult);
        console.log(`Posted (reel): ${JSON.stringify(postResult).slice(0,300)} postId=${postId}`);
        if (!postId) {
          console.warn(`[verify] No postId extracted from result, treating as failure`);
          throw new Error("No postId in create response");
        }
        // === STRICT POST-PUBLISH CHECK: GET post, if mediaItems 0 or content empty or platforms[0] status not published, DELETE/unpublish + blacklist + retry ===
        const ver = await verifyPostPublished(postId, { retries: verifyRetries, delayMs: 5000 });
        // Also direct GET check for strict emptiness even if isPostVerified says something else
        let strictFail = null;
        if (!ver.verified) strictFail = ver.reason;
        else {
          const fresh = await getPost(postId);
          const emptyMedia = !Array.isArray(fresh.mediaItems) || fresh.mediaItems.length === 0;
          const emptyContent = !fresh.content || fresh.content.trim().length === 0;
          const platStatus = fresh.platforms?.[0]?.status;
          if (emptyMedia) strictFail = "post-publish check: mediaItems.length 0";
          else if (emptyContent) strictFail = "post-publish check: content empty";
          else if (platStatus !== "published") strictFail = `post-publish check: platforms[0].status=${platStatus} not published`;
        }
        if (strictFail) {
          console.warn(`[post-publish] ✗ Post ${postId} FAILED strict check: ${strictFail} — deleting/unpublishing + blacklisting`);
          try {
            const un = await unpublishPost(postId);
            console.log(`[post-publish] unpublish ${postId} => ${un.status}`);
            if (!un.ok) { const del = await deletePost(postId); console.log(`[post-publish] delete ${postId} => ${del.status}`); }
          } catch (e2) { console.warn(`[post-publish] cleanup error: ${e2.message}`); }
          // blacklist candidate
          blacklisted.add(candidate.id);
          for (const k of highlightPostedKeys(candidate)) blacklisted.add(k);
          posted.add(candidate.id);
          for (const k of highlightPostedKeys(candidate)) posted.add(k);
          savePosted(posted);
          throw new Error(`Post-publish strict check failed: ${strictFail}`);
        }
        console.log(`[verify] ✓ Post verified: ${postId} — ${ver.reason}`);
        postVerified = true;
          // update h to successful candidate for posted.json
          h = candidate;
          mediaUrls = candidateMediaUrls;
          localVideoPath = candidateLocalPath;
          break;
      } catch (e) {
        const isFbError = /moved|rejected|blocked/i.test(e.message || "");
        console.warn(`[post] Attempt ${retryCount + 1}/${MAX_POST_RETRIES + 1} failed${isFbError ? " (Facebook moved/rejected/blocked)" : ""}: ${e.message?.slice(0,400)}`);
        if (retryCount >= MAX_POST_RETRIES) {
          console.error(`[post] All ${MAX_POST_RETRIES + 1} attempts exhausted for ${candidate.title} — skipping`);
          break;
        }
        // Try next candidate from toPost
        const nextIdx = currentIdx + 1;
        if (nextIdx >= toPost.length) {
          console.warn(`[post] No more candidates to retry (nextIdx ${nextIdx} >= ${toPost.length})`);
          break;
        }
        const next = toPost[nextIdx];
        console.log(`[post] Retrying with next candidate: ${next.title} (retry ${retryCount + 1}/${MAX_POST_RETRIES})`);
        // Prepare next candidate media (reuse same download logic if needed)
        let nextMedia = next.mediaUrls || next.mediaFiles || [];
        let nextLocal = next.localVideoPath || null;
        const nextLink = next.videoUrl || next.embedUrl || "";
        if (!nextMedia.length && !nextLocal && nextLink) {
          const dl = await downloadVideoFile(nextLink, next.id);
          if (dl) { nextLocal = dl; nextMedia = [dl]; }
        }
        if (!nextMedia.length && nextLocal) nextMedia = [nextLocal];
        if (!nextMedia.length) {
          console.warn(`[post] Next candidate has no video file, skipping: ${next.title}`);
          currentIdx = nextIdx;
          idx = nextIdx;
          retryCount++;
          continue;
        }
        // Validate next candidate quickly
        const v2 = await validateHighlight(next, { localVideoPath: nextLocal || nextMedia[0] });
        if (!v2.valid) {
          console.warn(`[post] Next candidate invalid: ${v2.reason} — skipping`);
          currentIdx = nextIdx;
          idx = nextIdx;
          retryCount++;
          continue;
        }
        // STRICT: presign next candidate's video before retry
        let nextStrictUrl;
        try {
          const f2 = nextLocal || nextMedia[0];
          if (!fs.existsSync(f2)) throw new Error(`file not found ${f2}`);
          if (fs.statSync(f2).size < 1_000_000) throw new Error(`file too small <1M`);
          nextStrictUrl = await presignUploadStrict(f2);
          validateMediaUrlsStrict([nextStrictUrl]);
        } catch (e3) {
          console.warn(`[strict] Next candidate presign failed: ${e3.message} — skipping`);
          posted.add(next.id); for (const k of highlightPostedKeys(next)) posted.add(k); savePosted(posted);
          currentIdx = nextIdx; idx = nextIdx; retryCount++; continue;
        }
        candidate = next;
        candidateMediaUrls = [nextStrictUrl];
        candidateLocalPath = nextLocal;
        currentIdx = nextIdx;
        idx = nextIdx; // advance outer loop so we don't reprocess consumed candidate
        retryCount++;
        // continue loop to post next candidate
      }
    }
    if (!postVerified) {
      console.error(`[post] Failed to publish verified reel after retries — not marking as posted, moving to next`);
      continue;
    }
    posted.add(h.id);
    for(const k of highlightPostedKeys(h)) posted.add(k);
    savePosted(posted);
    const ts = new Date().toISOString().slice(0,16).replace('T',' ');
    const logLine = `[${ts} UTC] VIDEO REEL POSTED: ${h.title} — POST _id=${postId} SUCCESS (${strictMediaUrl})\n`;
    try { fs.appendFileSync("/home/john/dev/football-maxx-poster/cron.log", logLine); } catch {}
  }
  await deduplicateRecentPosts();
  console.log("Done. Posted IDs saved to posted.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
