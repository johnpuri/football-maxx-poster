/**
 * validateHighlight — ensures only real game highlights are posted.
 * Checks: highlight keywords, banned keywords, FIFA copyright block, video file validity (ffprobe/duration),
 * logo availability, YouTube link safety, cartoon detection (keyword + Kimi vision on thumbnail).
 *
 * FIFA COPYRIGHT SAFEGUARD (2026-08-20):
 * World Cup Final highlights from FIFA.tv official channel are HIGH RISK — FIFA enforces Content ID
 * and blocks 15s+ segments even with watermark/transformative edits. Validation REJECTS these entirely.
 * Safe content: club leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League
 * fan edits, Europa, FA Cup) have lower enforcement. Country games allowed at 20% weight but must avoid
 * WC Finals. Watermark covering FIFA.tv + pad bar HIGH UP is applied for remaining content but NOT relied
 * on for WC Finals — they are banned outright.
 */
import fs from "fs";
import { execSync } from "child_process";
import { formatPost } from "./formatter.js";
import { requireTournamentLogo, getTournamentLogoPath } from "./config.js";
import { isCartoonVideo, isCartoonVideoSync } from "./cartoonFilter.js";

export const BANNED_KEYWORDS = [
  "cartoon", "animation", "animated", "parody", "442oons",
  "pes", "efootball", "fifa game", "fifa 16", "fifa 17", "fifa 18", "fifa 19",
  "fifa 20", "fifa 21", "fifa 22", "fifa 23", "fifa 24", "fifa 25",
  "simulation", "simulated", "lego", "minecraft", "roblox",
  "trailer", "gameplay", "gaming", "ps5", "ps4", "xbox",
  "funny moments", "compilation funny"
];
const BANNED_REGEX = new RegExp(BANNED_KEYWORDS.join("|"), "i");
// Strict: PES, eFootball etc always banned; FIFA only banned with game context
const STRICT_BANNED = /cartoon|animation|animated|parody|442oons|pes|efootball|simulation|simulated|lego|minecraft|roblox|trailer/i;

// FIFA high-risk block — WC Final from official FIFA channel is banned
export const FIFA_OFFICIAL_UPLOADERS = ["fifa", "fifa tv", "fifatv", "fifa world cup", "fifa.com"];
export const SAFE_LEAGUES = ["premier league", "la liga", "laliga", "serie a", "bundesliga", "ligue 1", "champions league", "ucl", "europa league", "europa", "fa cup"];
export const BANNED_TOURNAMENTS_FINALS = [/world cup.*final/i, /fifa world cup final/i];

export function isFifaHighRisk(highlight) {
  const title = (highlight.title || "").toLowerCase();
  const desc = (highlight.description || "").toLowerCase();
  const league = (highlight.league || highlight.tournament || "").toLowerCase();
  const uploader = (highlight.uploader || highlight.uploaderId || highlight.channel || highlight.uploader_id || "").toLowerCase();
  const combined = `${title} ${desc} ${league}`;
  const isWorldCup = /world cup/i.test(combined);
  const isFinal = /final/i.test(combined);
  const hasYear = /\b(19|20)\d{2}\b/.test(combined);
  const hasFifaWcFinalPhrase = /fifa world cup final/i.test(combined) || (isWorldCup && isFinal);
  const isOfficialFifaUploader = FIFA_OFFICIAL_UPLOADERS.some(u => uploader.includes(u)) || /fifa\.tv/i.test(uploader);
  const hasFifaTvMarker = /fifa\.tv/i.test(title) || /fifa\.tv/i.test(desc);
  // Rule 1: If title/description contains "FIFA World Cup Final" + year and uploader is FIFA official → block
  if (/fifa world cup final/i.test(combined) && hasYear && (isOfficialFifaUploader || hasFifaTvMarker)) {
    return { risk: true, reason: "FIFA World Cup Final + year from official FIFA channel (FIFA.tv) — high Content ID risk" };
  }
  // Rule 2: league contains World Cup and is Final and uploader official FIFA → block
  if (isWorldCup && isFinal && isOfficialFifaUploader) {
    return { risk: true, reason: "World Cup Final from official FIFA uploader — banned (Content ID block)" };
  }
  // Rule 3: Any World Cup Final highlight from FIFA.tv domain in title/desc is high risk
  if (hasFifaWcFinalPhrase && (isOfficialFifaUploader || hasFifaTvMarker)) {
    return { risk: true, reason: "World Cup Final highlights from FIFA.tv official are high risk — banned" };
  }
  // Rule 4: Any World Cup Final pattern is banned outright (prefer club game)
  if (/world cup\s+\d{4}\s+final/i.test(combined)) {
    return { risk: true, reason: "World Cup Final detected — banned to avoid FIFA copyright block (use club game instead)" };
  }
  return { risk: false };
}

export const HIGHLIGHT_KEYWORDS = [
  "highlight", "highlights", "goal", "goals", "vs", "vs.", "v ",
  "score", "result", "match", "full match", "extended highlights"
];

function containsHighlightKeyword(text) {
  const lower = text.toLowerCase();
  // Direct keyword match
  if (HIGHLIGHT_KEYWORDS.some(k => lower.includes(k.toLowerCase()))) return true;
  // Score pattern e.g. 2-1, 3:0, 1 - 0
  if (/\b\d+\s*[-:]\s*\d+\b/.test(text)) return true;
  // League name pattern
  if (/(premier league|la liga|laliga|bundesliga|serie a|ligue 1|champions league|ucl|world cup|euro|copa america|fa cup|europa league)/i.test(text)) return true;
  // Team vs team pattern (e.g. "France vs Brazil", "Real Madrid - Barcelona")
  if (/\b\w+\s+vs\.?\s+\w+/i.test(text)) return true;
  return false;
}

function containsBannedKeyword(text) {
  const lower = text.toLowerCase();
  if (STRICT_BANNED.test(lower)) return true;
  if (/\bfifa\b/i.test(lower) && /(game|simulation|simulated|gameplay|ps[45]|xbox|efootball|pes)/i.test(lower)) return true;
  // generic banned check (but don't flag real football content that mentions "trailer" etc — trailer is always banned for highlights)
  if (/\btrailer\b/i.test(lower)) return true;
  if (BANNED_REGEX.test(lower) && STRICT_BANNED.test(lower)) return true;
  // Fallback: check each banned keyword literally
  for (const kw of BANNED_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      // Avoid false positive: "fifa game" already handled; plain "pes" substring could match inside words — use word boundary for short terms
      if (["pes"].includes(kw.toLowerCase())) {
        if (new RegExp(`\\b${kw}\\b`, "i").test(lower)) return true;
      } else {
        return true;
      }
    }
  }
  return false;
}

function getVideoDurationSeconds(filePath) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}" 2>&1`, { encoding: "utf8", timeout: 10000 }).trim();
    const d = parseFloat(out);
    if (!isNaN(d) && d > 0) return d;
  } catch {}
  // fallback: stream duration
  try {
    const out2 = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}" 2>&1`, { encoding: "utf8", timeout: 10000 }).trim();
    const d2 = parseFloat(out2);
    if (!isNaN(d2) && d2 > 0) return d2;
  } catch {}
  return null;
}

function hasVideoStream(filePath) {
  try {
    const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type,codec_name,width,height -of csv "${filePath}" 2>&1`, { encoding: "utf8", timeout: 10000 }).trim();
    // Expect at least one video stream line
    if (out && out.includes("video")) return true;
    // Also check via json
    const json = execSync(`ffprobe -v error -show_streams -of json "${filePath}" 2>&1`, { encoding: "utf8", timeout: 10000 });
    const parsed = JSON.parse(json);
    if (parsed.streams && parsed.streams.some(s => s.codec_type === "video" && s.width > 100 && s.height > 100)) return true;
  } catch {}
  return false;
}

/**
 * Validate a highlight before posting.
 * @param {object} highlight - highlight object {title, description, league, videoUrl, embedUrl, thumbnail, tournament, year, homeTeam, awayTeam, localVideoPath, mediaUrls}
 * @param {object} opts - { localVideoPath, skipVideoCheck, skipVision }
 * @returns {{valid:boolean, reason:string, details:object}}
 */
export async function validateHighlight(highlight, opts = {}) {
  const title = highlight.title || "";
  const description = highlight.description || highlight.league || "";
  const league = highlight.league || highlight.tournament || "";
  const combinedText = `${title} ${description} ${league} ${highlight.homeTeam || ""} ${highlight.awayTeam || ""}`.trim();
  const thumbnail = highlight.thumbnail || (highlight.videoUrl ? `https://img.youtube.com/vi/${extractYoutubeId(highlight.videoUrl)}/hqdefault.jpg` : "");

  // 1. Is real game highlight — must contain highlight keywords
  if (!containsHighlightKeyword(combinedText)) {
    return { valid: false, reason: `Not a real game highlight — title/description missing highlight keywords (Highlight/Goal/vs/score/league). Got: "${title.slice(0,80)}"`, details: { check: "highlightKeywords" } };
  }

  // 2. Must NOT contain banned keywords
  if (containsBannedKeyword(combinedText)) {
    return { valid: false, reason: `Banned keyword detected in title/description — likely not real footage (cartoon/PES/FIFA game/simulation/trailer). Got: "${title.slice(0,80)}"`, details: { check: "bannedKeywords" } };
  }

  // 2b. FIFA copyright block — World Cup Finals are high risk (FIFA.tv Content ID)
  const fifaRisk = isFifaHighRisk(highlight);
  if (fifaRisk.risk) {
    return { valid: false, reason: `FIFA copyright block: ${fifaRisk.reason}. Pick club game instead (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League fan edits, Europa, FA Cup). Got: "${title.slice(0,80)}"`, details: { check: "fifaCopyright" } };
  }

  // 3. Cartoon check — keyword + vision on thumbnail
  if (isCartoonVideoSync(title, description)) {
    return { valid: false, reason: `Cartoon/animated content detected via keyword filter: "${title.slice(0,80)}"`, details: { check: "cartoonKeyword" } };
  }
  if (thumbnail && !opts.skipVision) {
    try {
      const isCartoon = await isCartoonVideo(title, description, thumbnail);
      if (isCartoon) {
        return { valid: false, reason: `Cartoon/animated content detected via vision (thumbnail: ${thumbnail}): "${title.slice(0,80)}"`, details: { check: "cartoonVision" } };
      }
    } catch (e) {
      console.warn(`[validate] cartoon vision check error (non-blocking): ${e.message}`);
    }
  }

  // 4. Is not YouTube link share — content must not contain youtube.com, post must be video mediaItems
  const content = formatPost(highlight);
  if (/youtube\.com|youtu\.be/i.test(content)) {
    return { valid: false, reason: `Post content contains YouTube link — must be video reel only, not link share`, details: { check: "youtubeLink" } };
  }
  // Also ensure highlight itself won't be posted as link — require video file path
  const videoFile = opts.localVideoPath || highlight.localVideoPath || (highlight.mediaUrls && highlight.mediaUrls[0]) || null;
  if (!opts.skipVideoCheck) {
    if (!videoFile) {
      // In dry-run/test we may not have downloaded; but for real posting, video file is required
      // For validation, if no videoFile provided, we check if videoUrl exists and warn — but still allow if skipVideoCheck is used in dry-run
      // For strict validation (before presign upload), video file must exist.
      // We treat missing file as invalid unless skipVideoCheck is true.
      // To support iteration of ytsearch candidates before download, caller should download first then validate.
      // Here we enforce: if opts.requireVideoFile !== false, we need file.
      if (opts.requireVideoFile === false) {
        // allowed to pass without file (e.g. dry-run metadata check)
      } else {
        return { valid: false, reason: `No video file available — post requires local mp4 for reel (YouTube links not allowed as link shares)`, details: { check: "videoFileMissing" } };
      }
    }
  }

  // 5. Is video file valid — exists, duration 60-250s, video stream, not image
  if (videoFile && !opts.skipVideoCheck) {
    if (!fs.existsSync(videoFile)) {
      return { valid: false, reason: `Video file does not exist: ${videoFile}`, details: { check: "videoExists" } };
    }
    const stat = fs.statSync(videoFile);
    if (stat.size < 10000) {
      return { valid: false, reason: `Video file too small (${stat.size} bytes) — likely not a valid video`, details: { check: "videoSize" } };
    }
    // Check it's not an image file masquerading as mp4
    const ext = videoFile.toLowerCase();
    if (ext.endsWith(".jpg") || ext.endsWith(".jpeg") || ext.endsWith(".png") || ext.endsWith(".webp")) {
      return { valid: false, reason: `Video file is an image, not a video: ${videoFile}`, details: { check: "videoIsImage" } };
    }
    if (!hasVideoStream(videoFile)) {
      return { valid: false, reason: `ffprobe: no video stream found in ${videoFile} — not a valid video`, details: { check: "videoStream" } };
    }
    const duration = getVideoDurationSeconds(videoFile);
    if (duration === null) {
      return { valid: false, reason: `ffprobe: could not determine video duration for ${videoFile}`, details: { check: "videoDurationUnknown" } };
    }
    if (duration < 60 || duration > 250) {
      const pref = duration >= 120 && duration <= 210 ? " (ideal 120-210s)" : "";
      if (duration < 60 || duration > 250) {
        return { valid: false, reason: `Video duration ${Math.round(duration)}s out of allowed range 60-250s${pref} — file: ${videoFile}`, details: { check: "videoDuration", duration } };
      }
    }
    // Prefer 120-210s warning but still valid if 60-250
    if (duration < 120 || duration > 210) {
      console.log(`[validate] Note: duration ${Math.round(duration)}s is outside preferred 120-210s but within allowed 60-250s — acceptable`);
    }
  }

  // 6. Is logo available — requireTournamentLogo exists, fail if missing
  const tournament = highlight.tournament || highlight.league || highlight.tournamentName || "";
  const year = highlight.year || (highlight.date ? new Date(highlight.date).getFullYear() : null);
  if (tournament) {
    try {
      const logoPath = requireTournamentLogo(tournament, year);
      if (!fs.existsSync(logoPath)) {
        return { valid: false, reason: `Missing required tournament logo for ${tournament} ${year || ""} at ${logoPath}`, details: { check: "logo" } };
      }
    } catch (e) {
      // If tournament is not mappable, try generic fallback — but requireTournamentLogo should handle GENERIC
      // Check generic exists
      const generic = getTournamentLogoPath("GENERIC");
      if (!fs.existsSync(generic)) {
        return { valid: false, reason: `Logo check failed for ${tournament}: ${e.message}`, details: { check: "logo", error: e.message } };
      }
      // If generic exists, allow posting with generic logo — not a failure
      console.log(`[validate] Using generic logo for ${tournament}: ${e.message}`);
    }
  } else {
    // No tournament specified — ensure generic logo exists
    const generic = getTournamentLogoPath("GENERIC");
    if (!fs.existsSync(generic)) {
      return { valid: false, reason: `Missing generic logo at ${generic} — logos are mandatory`, details: { check: "logoGeneric" } };
    }
  }

  return { valid: true, reason: "All checks passed", details: { check: "all" } };
}

function extractYoutubeId(url) {
  if (!url) return "";
  const m = url.match(/(?:v=|\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : "";
}

/**
 * Iterate ytsearch candidates 1-5, download and validate until valid highlight found.
 * Returns { highlight, videoPath, validResult } or null if none valid.
 */
export async function pickValidHighlightFromCandidates(query, baseHighlight, downloadFn) {
  const { execSync } = await import("child_process");
  const { isCartoonVideo } = await import("./cartoonFilter.js");
  let out = "";
  try {
    out = execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`, { timeout: 20000, encoding: "utf8" }).trim();
  } catch { return null; }
  const lines = out.split("\n").filter(Boolean);
  const candidates = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const title = lines[i];
    const id = lines[i + 1];
    if (/^[A-Za-z0-9_-]{6,}$/.test(id)) candidates.push({ id, title, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, uploader: "" });
  }
  if (!candidates.length) {
    const ids = out.split("\n").map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{6,}$/.test(s));
    for (const id of ids) candidates.push({ id, title: "", thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, uploader: "" });
  }
  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    const videoUrl = `https://www.youtube.com/watch?v=${c.id}`;
    const candidateHighlight = {
      ...baseHighlight,
      title: c.title || baseHighlight.title,
      videoUrl,
      embedUrl: videoUrl,
      thumbnail: c.thumbnail,
      uploader: c.uploader || "",
    };
    console.log(`[validate] Trying candidate ${idx + 1}/${candidates.length}: ${c.id} — ${c.title}`);
    // FIFA WC Final pre-check (title/uploader) — reject before download, pick club game instead
    {
      const candCheck = isFifaHighRisk({ title: c.title, description: c.title, league: baseHighlight.league || baseHighlight.tournament || "", uploader: c.uploader || "" });
      if (candCheck.risk) { console.log(`[validate] Skipping FIFA high-risk candidate: ${c.title} — ${candCheck.reason}`); continue; }
    }
    // Early cartoon keyword skip before download
    if (isCartoonVideoSync(c.title, "")) {
      console.log(`[validate] Skipping cartoon candidate: ${c.title}`);
      continue;
    }
    // Deeper vision check
    try {
      if (await isCartoonVideo(c.title, "", c.thumbnail)) {
        console.log(`[validate] Skipping cartoon via vision: ${c.title}`);
        continue;
      }
    } catch {}
    // Download video for validation
    let videoPath = null;
    if (downloadFn) {
      try { videoPath = await downloadFn(videoUrl, `${baseHighlight.id || "candidate"}_${c.id}`); } catch {}
    }
    const result = await validateHighlight(candidateHighlight, { localVideoPath: videoPath, requireVideoFile: true });
    if (result.valid) {
      console.log(`[validate] ✓ Candidate ${idx + 1} valid: ${c.title}`);
      return { highlight: candidateHighlight, videoPath, validResult: result };
    } else {
      console.log(`[validate] ✗ Candidate ${idx + 1} failed: ${result.reason}`);
      // Clean up failed download
      if (videoPath && fs.existsSync(videoPath)) { try { fs.unlinkSync(videoPath); } catch {} }
    }
  }
  return null;
}
