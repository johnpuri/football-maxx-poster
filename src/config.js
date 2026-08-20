import "dotenv/config";

// Supported leagues - Highlightly covers 950+ leagues
// These are the ones Football Maxx prioritizes
export const PRIORITY_LEAGUES = [
  { name: "English Premier League", keys: ["premier league", "epl", "english premier"] },
  { name: "La Liga", keys: ["la liga", "laliga", "primera"] },
  { name: "Bundesliga", keys: ["bundesliga"] },
  { name: "Serie A", keys: ["serie a"] },
  { name: "Ligue 1", keys: ["ligue 1"] },
  { name: "UEFA Champions League", keys: ["champions league", "ucl"] },
  { name: "FIFA World Cup", keys: ["world cup", "fifa world"] },
  { name: "UEFA Euro", keys: ["euro", "european championship"] },
  { name: "Copa America", keys: ["copa america"] },
];

export const config = {
  zernioApiKey: process.env.ZERNIO_API_KEY || "",
  zernioBaseUrl: process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1",
  facebookAccountId: process.env.FACEBOOK_ACCOUNT_ID || "",
  facebookProfileId: process.env.FACEBOOK_PROFILE_ID || "",
  highlightlyKey: process.env.HIGHLIGHTLY_RAPIDAPI_KEY || "",
  highlightlyBaseUrl: process.env.HIGHLIGHTLY_BASE_URL || "https://highlightly.p.rapidapi.com",
  scorebatToken: process.env.SCOREBAT_TOKEN || "",
  dryRun: process.env.DRY_RUN === "true",
  maxHighlightsPerRun: parseInt(process.env.MAX_HIGHLIGHTS_PER_RUN || "3", 10),
  postIntervalHours: parseInt(process.env.POST_INTERVAL_HOURS || "6", 10),
};

export function validateConfig({ requireZernio = false, requireHighlightly = false } = {}) {
  const missing = [];
  if (requireZernio && !config.zernioApiKey) missing.push("ZERNIO_API_KEY");
  if (requireHighlightly && !config.highlightlyKey) missing.push("HIGHLIGHTLY_RAPIDAPI_KEY");
  if (missing.length) throw new Error(`Missing required env: ${missing.join(", ")}`);
}

export function isPriorityLeague(leagueName) {
  if (!leagueName) return false;
  const lower = leagueName.toLowerCase();
  return PRIORITY_LEAGUES.some((l) => l.keys.some((k) => lower.includes(k)));
}

export function priorityScore(leagueName) {
  if (!leagueName) return 0;
  const lower = leagueName.toLowerCase();
  for (let i = 0; i < PRIORITY_LEAGUES.length; i++) {
    if (PRIORITY_LEAGUES[i].keys.some((k) => lower.includes(k))) return 100 - i; // earlier = higher
  }
  return 0;
}
