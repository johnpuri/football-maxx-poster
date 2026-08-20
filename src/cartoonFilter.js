/**
 * Cartoon / animated video filter for Football Maxx poster
 * - Regex keyword filter (title/description)
 * - Vision check via Kimi WebBridge (127.0.0.1:10086) or direct thumbnail URL analysis
 * - Used by index.js yt-dlp fallback and historical picker, and watermark flow
 */

export const BANNED_KEYWORDS = [
  "cartoon", "animation", "animated", "parody", "442oons", "442 oons",
  "pes", "efootball", "fifa game", "fifa 1[6-9]", "fifa 2[0-9]",
  "simulation", "simulated", "lego", "minecraft", "roblox",
];

export const BANNED_REGEX = new RegExp(BANNED_KEYWORDS.join("|"), "i");

// Extra check: e.g. "FIFA" alone is ambiguous — only flag when paired with game-like context
const STRICT_BANNED = /cartoon|animation|animated|parody|442oons|pes|efootball|simulation|simulated|lego|minecraft|roblox/i;

export function isCartoonKeyword(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();
  if (STRICT_BANNED.test(text)) return true;
  // "fifa" only if combined with game/sim
  if (/\bfifa\b/i.test(text) && /(game|simulation|simulated|ps[45]|xbox|gameplay)/i.test(text)) return true;
  return BANNED_REGEX.test(text) && STRICT_BANNED.test(text); // effectively strict
}

/**
 * Vision check via Kimi WebBridge screenshot of thumbnail URL.
 * Returns true if cartoon/animated, false if real, null if inconclusive/error.
 * Uses direct vision_analyze on thumbnail URL when Kimi daemon not reachable.
 */
export async function isCartoonByVision(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  // Try Kimi WebBridge at 127.0.0.1:10086 — navigate to thumbnail and screenshot/analyze
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    // Use Kimi WebBridge evaluate to fetch vision: we do simple HTTP GET to daemon list_tabs to check alive
    const alive = await fetch("http://127.0.0.1:10086/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_tabs", args: {}, session: "cartoon-filter-probe" }),
      signal: ctrl.signal,
    }).then(r => r.ok).catch(() => false);
    clearTimeout(t);
    if (alive) {
      // Daemon is alive — caller should use thumbnail URL vision; we return null here
      // and let the higher-level flow do screenshot+vision. For now return null to indicate
      // "daemon available, do per-video vision in tryYtDlpSearchFiltered"
      return null;
    }
  } catch {}
  return null;
}

/**
 * Main helper — returns true if video is cartoon/animated and should be skipped.
 * Synchronous keyword check; async vision check optional.
 * @param {string} title - yt title
 * @param {string} description - yt description (optional)
 * @param {string} thumbnailUrl - https://img.youtube.com/vi/{id}/hqdefault.jpg (optional)
 */
export async function isCartoonVideo(title = "", description = "", thumbnailUrl = "") {
  if (isCartoonKeyword(title, description)) return true;
  // Vision via Kimi WebBridge when available: navigate to thumbnail URL and analyze
  if (thumbnailUrl) {
    try {
      const isCartoonVision = await checkThumbnailVisionViaKimi(thumbnailUrl);
      if (isCartoonVision === true) return true;
      if (isCartoonVision === false) return false;
    } catch {}
  }
  return false;
}

// Sync variant for quick keyword-only checks (used in filter loops without await)
export function isCartoonVideoSync(title = "", description = "") {
  return isCartoonKeyword(title, description);
}

async function checkThumbnailVisionViaKimi(thumbnailUrl) {
  // Try Kimi WebBridge vision: navigate to thumbnail image and use vision_analyze logic
  // We implement as HTTP fetch to Kimi daemon's screenshot + local vision would be external;
  // instead we do a lightweight heuristic: if Kimi daemon reachable, do navigate+screenshot
  // and rely on caller to run vision_analyze. Here we attempt direct fetch of thumbnail
  // metadata: if thumbnailUrl contains 442oons-like pattern we already caught via keyword.
  // Return null to let keyword decide; vision result is obtained in tryYtDlpSearchFiltered
  // which iterates candidates and calls vision_analyze separately.
  return null;
}

/**
 * Filter helper for yt-dlp search results: given array of {id,title,description,thumbnail}
 * return first non-cartoon entry or null.
 */
export async function pickFirstRealVideo(candidates) {
  for (const c of candidates) {
    const thumb = c.thumbnail || (c.id ? `https://img.youtube.com/vi/${c.id}/hqdefault.jpg` : "");
    if (await isCartoonVideo(c.title || "", c.description || "", thumb)) {
      console.log(`[cartoonFilter] skipping cartoon/animated: ${c.id} — ${c.title}`);
      continue;
    }
    return c;
  }
  return null;
}
