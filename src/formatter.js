/**
 * Format highlight into Facebook post copy — VIDEO REEL ONLY
 * Never include YouTube links (videoUrl/embedUrl). Post must be video file upload.
 * STRICT: caption must be derived solely from highlight metadata validated against yt video title.
 * highlight.title must already be the validated yt title (or derived from homeTeam/awayTeam/tournament/year).
 * Do NOT use random titles disconnected from video.
 */
export function formatPost(highlight) {
  // Prefer validated yt title; fallback to title built from teams
  let title = highlight.ytTitle || highlight.candidateTitle || highlight.title || "";
  // If title doesn't contain both teams but we have teams, rebuild strictly from metadata
  const home = highlight.homeTeam || "";
  const away = highlight.awayTeam || "";
  const tournament = highlight.tournament || "";
  const leagueField = highlight.league || (tournament && highlight.year ? `${tournament} ${highlight.year}` : tournament) || "";
  const year = highlight.year || "";

  // Validate title contains both teams; if not, rebuild from teams + tournament/year
  if (home && away) {
    const lower = title.toLowerCase();
    const homeOk = lower.includes(home.toLowerCase());
    const awayOk = lower.includes(away.toLowerCase());
    if (!homeOk || !awayOk) {
      // Rebuild title strictly from highlight metadata
      if (tournament && year) title = `${tournament} ${year} — ${home} vs ${away}`;
      else title = `${home} vs ${away}`;
    }
  }

  // Ensure league line comes from highlight metadata, not random
  let leagueLine = "";
  if (leagueField) leagueLine = `🏆 ${leagueField}`;
  else if (tournament) leagueLine = year ? `🏆 ${tournament} ${year}` : `🏆 ${tournament}`;
  else leagueLine = "⚽ Football Highlight";

  const dateStr = highlight.date ? formatDate(highlight.date) : (year ? formatDate(`${year}-07-01`) : "");

  // Safety: never allow youtube link in content
  if (/youtube\.com|youtu\.be/i.test(title) || /youtube\.com|youtu\.be/i.test(leagueLine)) {
    throw new Error("formatPost: YouTube link detected — must be video reel only");
  }

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
  const tags = leagueHashtags(highlight.league || highlight.tournament);
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
