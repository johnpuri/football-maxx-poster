/**
 * Main runner: fetch highlights (Highlightly → ScoreBat fallback) → post via Zernio
 */
import "dotenv/config";
import { config } from "./config.js";
import { fetchHighlights, filterAndRank } from "./highlightly.js";
import { fetchScorebatHighlights, filterAndRankScorebat } from "./scorebat.js";
import { createFacebookPost } from "./zernio.js";
import { formatPost } from "./formatter.js";
import fs from "fs";

const POSTED_FILE = "./posted.json";

function loadPosted() {
  try { return new Set(JSON.parse(fs.readFileSync(POSTED_FILE, "utf8"))); } catch { return new Set(); }
}
function savePosted(set) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify([...set], null, 2));
}

async function getHighlights() {
  // Try Highlightly first if key present
  if (config.highlightlyKey) {
    try {
      console.log("Fetching from Highlightly...");
      const raw = await fetchHighlights({ limit: 20 });
      const ranked = filterAndRank(raw, config.maxHighlightsPerRun * 3);
      if (ranked.length) return ranked;
      console.log("Highlightly returned 0, trying ScoreBat fallback...");
    } catch (e) {
      console.warn("Highlightly failed:", e.message, "→ falling back to ScoreBat");
    }
  } else {
    console.log("No HIGHLIGHTLY_RAPIDAPI_KEY, using ScoreBat directly");
  }
  try {
    const sb = await fetchScorebatHighlights({ token: config.scorebatToken, limit: 20 });
    return filterAndRankScorebat(sb, config.maxHighlightsPerRun * 3);
  } catch (e) {
    console.warn("ScoreBat also failed:", e.message);
    if (config.highlightlyKey) throw e;
    console.warn("No highlights available - set HIGHLIGHTLY_RAPIDAPI_KEY (free 100/day) or SCOREBAT_TOKEN. See README.");
    return [];
  }
}

async function main() {
  console.log(`Football Maxx Poster — dryRun=${config.dryRun}`);
  const posted = loadPosted();
  const highlights = await getHighlights();
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
