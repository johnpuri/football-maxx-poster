/**
 * Format highlight into Facebook post copy — VIDEO REEL ONLY
 * Never include YouTube links (videoUrl/embedUrl). Post must be video file upload.
 */
export function formatPost(highlight) {
  const { title, league, date } = highlight;
  const leagueLine = league ? `🏆 ${league}` : "⚽ Football Highlight";
  const dateStr = date ? formatDate(date) : "";
  const lines = [
    `⚽ ${title}`,
    "",
    leagueLine,
    dateStr ? `📅 ${dateStr}` : "",
    "",
    "#Football #Highlights #FootballMaxx",
  ].filter(Boolean);
  return lines.join("\n");
}

function formatDate(d) {
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return d; }
}

export function formatPostWithHashtags(highlight) {
  const base = formatPost(highlight);
  const tags = leagueHashtags(highlight.league);
  if (tags) return `${base}\n${tags}`;
  return base;
}

function leagueHashtags(league) {
  if (!league) return "";
  const l = league.toLowerCase();
  if (l.includes("premier")) return "#PremierLeague #EPL";
  if (l.includes("la liga") || l.includes("laliga")) return "#LaLiga";
  if (l.includes("bundesliga")) return "#Bundesliga";
  if (l.includes("serie a")) return "#SerieA";
  if (l.includes("ligue 1")) return "#Ligue1";
  if (l.includes("champions")) return "#UCL #ChampionsLeague";
  if (l.includes("world cup")) return "#WorldCup";
  if (l.includes("euro")) return "#Euro";
  if (l.includes("copa america")) return "#CopaAmerica";
  return "";
}
