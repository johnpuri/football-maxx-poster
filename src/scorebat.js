/**
 * ScoreBat fallback - free, no YouTube API needed
 * Docs: https://www.scorebat.com/video-api/
 * Endpoint returns up to ~20 recent highlights; structure verified 2026.
 */
import { priorityScore } from "./config.js";

const SCOREBAT_URL = "https://www.scorebat.com/video-api/v3/feed/";

function scorebatUrl(token) {
  if (token) return `${SCOREBAT_URL}?token=${encodeURIComponent(token)}`;
  return SCOREBAT_URL;
}

export async function fetchScorebatHighlights({ token = "", limit = 20 } = {}) {
  const url = scorebatUrl(token);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ScoreBat ${res.status}: ${await res.text().then(t=>t.slice(0,400))}`);
  const data = await res.json();
  const arr = data.response || data.result || data.videos || [];
  // ScoreBat items have: title, competition, videos: [{ embed }], thumbnail, date
  const normalized = arr.slice(0, limit).map((item) => ({
    id: item.title?.replace(/\s+/g, "-").slice(0, 50) || Math.random().toString(36).slice(2),
    title: item.title || `${item.side1?.name || ""} vs ${item.side2?.name || ""}`.trim(),
    league: item.competition || item.league || "",
    homeTeam: item.side1?.name || "",
    awayTeam: item.side2?.name || "",
    date: item.date || "",
    videoUrl: item.videos?.[0]?.embed || item.videos?.[0]?.url || item.embed || "",
    thumbnail: item.thumbnail || item.thumb || "",
    embedUrl: item.videos?.[0]?.embed || "",
    source: "scorebat",
    raw: item,
  })).filter(h => h.videoUrl || h.title);
  return normalized;
}

export function filterAndRankScorebat(highlights, max = 10) {
  return highlights
    .map((h) => ({ ...h, _score: priorityScore(h.league) }))
    .sort((a, b) => b._score - a._score || new Date(b.date) - new Date(a.date))
    .slice(0, max);
}
