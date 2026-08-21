/**
 * ytParser — single source of truth derived from YouTube title
 * Extracts homeTeam, awayTeam, tournament, year, stage via regex.
 */
export function parseHighlightFromTitle(ytTitle, opts={}){
  const title = (ytTitle||"").trim();
  // Extract teams: "TeamA vs TeamB", "TeamA vs. TeamB", "TeamA - TeamB", "TeamA v TeamB"
  // Prefer vs pattern
  const vsRegex = /([\p{L}0-9 .'\-]+?)\s+(?:vs\.?|v\.?)\s+([\p{L}0-9 .'\-]+?)(?:\s*[|\-–—:\(]|$)/iu;
  let homeTeam="", awayTeam="";
  const m = title.match(vsRegex);
  if(m){
    homeTeam = cleanTeam(m[1]);
    awayTeam = cleanTeam(m[2]);
    // trim trailing score/year fragments
    awayTeam = awayTeam.split(/\s+\d+[-:]\d+/)[0].trim();
    awayTeam = awayTeam.split(/\s+\d{4}/)[0].trim();
    awayTeam = awayTeam.replace(/\s+highlights.*/i,"").trim();
  } else {
    // fallback dash pattern: "TeamA - TeamB"
    const dash = title.match(/^([\p{L}0-9 .'\-]+?)\s+[-–—]\s+([\p{L}0-9 .'\-]+?)(?:\s*[|\(:]|$)/u);
    if(dash){ homeTeam=cleanTeam(dash[1]); awayTeam=cleanTeam(dash[2]); }
  }
  // Extract year
  let year = null;
  const yearMatch = title.match(/\b(19|20)\d{2}(\/\d{2})?\b/);
  if(yearMatch) year = parseInt(yearMatch[0].slice(0,4),10);
  if(!year && opts.fallbackYear) year = opts.fallbackYear;
  // Extract tournament
  let tournament = opts.fallbackTournament || detectTournament(title) || "Football";
  // Stage
  let stage = "Highlights";
  if(/final/i.test(title)) stage="Final";
  else if(/semi/i.test(title)) stage="Semi Final";
  else if(/quarter/i.test(title)) stage="Quarter Final";
  else if(/group/i.test(title)) stage="Group Stage";
  return { homeTeam, awayTeam, tournament, year, stage, ytTitle:title };
}

function cleanTeam(s){
  return s.trim()
    .replace(/^highlights\s*[-:]/i,"")
    .replace(/\s+highlights.*/i,"")
    .replace(/\s*\|\s*.*/,"")
    .replace(/\s*-\s*highlights.*/i,"")
    .trim()
    .split(/\s+/).slice(0,4).join(" ") // limit to 4 words
    .trim();
}

function detectTournament(title){
  const t=title.toLowerCase();
  if(t.includes("premier league")||t.includes("epl")) return "Premier League";
  if(t.includes("la liga")||t.includes("laliga")) return "La Liga";
  if(t.includes("bundesliga")) return "Bundesliga";
  if(t.includes("serie a")) return "Serie A";
  if(t.includes("ligue 1")) return "Ligue 1";
  if(t.includes("champions league")||/\bucl\b/i.test(title)) return "Champions League";
  if(t.includes("europa league")) return "Europa League";
  if(t.includes("fa cup")) return "FA Cup";
  if(t.includes("world cup")) return "World Cup";
  if(/\beuro\b/i.test(title)||t.includes("european championship")) return "Euro";
  if(t.includes("copa america")) return "Copa America";
  return "";
}

export function validateTripleMatch(highlight, ytTitle, contentFirstLine, watermarkTexts){
  // highlight: parsed object, ytTitle: string, contentFirstLine: e.g. "⚽ Tournament Year — Home vs Away", watermarkTexts: {tournamentYear, matchText, stage}
  const norm = s=> s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  const yt = norm(ytTitle);
  const homeOk = highlight.homeTeam && yt.includes(norm(highlight.homeTeam));
  const awayOk = highlight.awayTeam && yt.includes(norm(highlight.awayTeam));
  if(!homeOk || !awayOk) return { ok:false, reason:`ytTitle teams mismatch: highlight ${highlight.homeTeam} vs ${highlight.awayTeam} not both in "${ytTitle.slice(0,80)}"`};
  // content first line must equal highlight teams+ tournament year
  const expectedFirst = `${highlight.homeTeam} vs ${highlight.awayTeam}`.toLowerCase();
  if(!norm(contentFirstLine).includes(norm(highlight.homeTeam)) || !norm(contentFirstLine).includes(norm(highlight.awayTeam)))
    return { ok:false, reason:`content first line mismatch highlight ${highlight.homeTeam} vs ${highlight.awayTeam} not in "${contentFirstLine.slice(0,80)}"`};
  if(watermarkTexts){
    if(!norm(watermarkTexts.matchText).includes(norm(highlight.homeTeam)) || !norm(watermarkTexts.matchText).includes(norm(highlight.awayTeam)))
      return { ok:false, reason:`watermark matchText mismatch`};
    const tourYear = `${highlight.tournament} ${highlight.year}`;
    if(!norm(watermarkTexts.tournamentYear).includes(norm(highlight.tournament)) || !String(watermarkTexts.tournamentYear).includes(String(highlight.year)))
      return { ok:false, reason:`watermark tournamentYear mismatch: ${watermarkTexts.tournamentYear} vs ${tourYear}`};
  }
  return { ok:true };
}
