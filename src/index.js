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
import { isFifaHighRisk } from "./validate.js";
import { validateHighlight, pickValidHighlightFromCandidates } from "./validate.js";
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

async function downloadVideoFile(videoUrl, id) {
  if (!videoUrl || !/^https?:\/\//.test(videoUrl)) return null;
  const outPath = `/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`;
  try {
    console.log(`[video] Downloading for reel: ${videoUrl} → ${outPath}`);
    execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${outPath}" "${videoUrl}" 2>&1 | tail -n 5`, { timeout: 120000, encoding: "utf8" });
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
  for (let h of toPost) {
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
      if (h.source === "historical-yt-dlp" && h.query) {
        // In dry-run, validate without downloading — skip video file check
        const dryResult = await validateHighlight(h, { skipVideoCheck: true });
        if (!dryResult.valid) {
          console.log(`[DRY RUN][validate] Initial candidate failed: ${dryResult.reason} — trying next ytsearch candidates 1-5...`);
          // Try to find next valid candidate via ytsearch iteration (metadata-only, no download)
          const { execSync: _exec } = await import("child_process");
          try {
            const out = _exec(`yt-dlp "ytsearch5:${h.query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`, { timeout: 20000, encoding: "utf8" }).trim();
            const lines = out.split("\n").filter(Boolean);
            const cands = [];
            for (let i = 0; i < lines.length - 1; i += 2) {
              const title = lines[i]; const id = lines[i+1];
              if (/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({ id, title, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` });
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
    if (!mediaUrls.length && !localVideoPath && videoLink && h.source === "historical-yt-dlp" && h.query) {
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
      continue;
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

    const result = await createFacebookPost({ content: formatPost(h), mediaUrls, publishNow: true });
    console.log("Posted (reel):", JSON.stringify(result).slice(0, 300));
    posted.add(h.id);
    savePosted(posted);
  }
  console.log("Done. Posted IDs saved to posted.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
