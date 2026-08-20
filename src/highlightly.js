/**
 * Highlightly Football API client (via RapidAPI)
 * Docs: https://highlightly.net / https://rapidapi.com/highlightly/api/highlightly
 * Free tier: 100 req/day. Endpoints: /highlights, /matches, /lineups, /standings, etc.
 * Auth: x-rapidapi-key + x-rapidapi-host headers
 */
import { config, priorityScore } from "./config.js";

const RAPIDAPI_HOST = "highlightly.p.rapidapi.com";

function headers() {
  if (!config.highlightlyKey) throw new Error("HIGHLIGHTLY_RAPIDAPI_KEY not set - see README");
  return {
    "x-rapidapi-key": config.highlightlyKey,
    "x-rapidapi-host": RAPIDAPI_HOST,
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Highlightly non-JSON: ${text.slice(0, 400)}`); }
  if (!res.ok) throw new Error(`Highlightly ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

/**
 * Fetch highlights - primary endpoint
 * Query params vary by Highlightly version; we try common patterns
 */
export async function fetchHighlights({ limit = 20 } = {}) {
  const url = `${config.highlightlyBaseUrl}/highlights?limit=${limit}`;
  try {
    const data = await fetchJson(url, { headers: headers() });
    return normalizeHighlights(data);
  } catch (e) {
    // Try alternate path without /v1 prefix
    if (e.message.includes("404")) {
      const altUrl = `${config.highlightlyBaseUrl}/api/highlights?limit=${limit}`;
      const data = await fetchJson(altUrl, { headers: headers() });
      return normalizeHighlights(data);
    }
    throw e;
  }
}

export async function fetchMatches({ date, league, limit = 20 } = {}) {
  let url = `${config.highlightlyBaseUrl}/matches?limit=${limit}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  if (league) url += `&league=${encodeURIComponent(league)}`;
  const data = await fetchJson(url, { headers: headers() });
  return Array.isArray(data) ? data : data.data || data.matches || [];
}

function normalizeHighlights(raw) {
  // Highlightly response shape may be { data: [...] } or array directly
  const arr = Array.isArray(raw) ? raw : raw.data || raw.highlights || raw.response || [];
  return arr.map(normalizeOne).filter(Boolean);
}

function normalizeOne(h) {
  if (!h) return null;
  return {
    id: h.id || h.matchId || h.fixture_id || String(h.title || "").slice(0, 40),
    title: h.title || `${h.homeTeam || h.home_team || ""} vs ${h.awayTeam || h.away_team || ""}`.trim() || "Football Highlight",
    league: h.league || h.competition || h.tournament || "",
    homeTeam: h.homeTeam || h.home_team || h.home || "",
    awayTeam: h.awayTeam || h.away_team || h.away || "",
    date: h.date || h.matchDate || h.datetime || "",
    videoUrl: h.videoUrl || h.video_url || h.url || h.embedUrl || h.embed_url || "",
    thumbnail: h.thumbnail || h.thumb || h.image || h.poster || "",
    embedUrl: h.embedUrl || h.embed_url || h.videoUrl || h.url || "",
    source: "highlightly",
    raw: h,
  };
}

export function filterAndRank(highlights, max = 10) {
  return highlights
    .filter((h) => h.videoUrl || h.embedUrl)
    .map((h) => ({ ...h, _score: priorityScore(h.league) }))
    .sort((a, b) => b._score - a._score || new Date(b.date) - new Date(a.date))
    .slice(0, max);
}
