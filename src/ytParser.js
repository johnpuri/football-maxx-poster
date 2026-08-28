/**
 * ytParser — single source of truth derived from YouTube title
 * Extracts homeTeam, awayTeam, tournament, year, stage via regex.
 */
export function parseHighlightFromTitle(ytTitle, opts={}){
  const title = (ytTitle||"").trim();
  const vsRegex = /([\p{L}0-9 .'\-]+?)\s+(?:vs\.?|v\.)\s+([\p{L}0-9 .'\-]+?)(?:\s*[|\-–—:\(]|$)/iu;
  let homeTeam="", awayTeam="";
  const m = title.match(vsRegex);
  if(m){
    homeTeam = cleanTeam(m[1]);
    awayTeam = cleanTeam(m[2]);
    awayTeam = awayTeam.split(/\s+\d+[-:]\d+/)[0].trim();
    awayTeam = awayTeam.split(/\s+\d{4}/)[0].trim();
    awayTeam = awayTeam.replace(/\s+highlights.*/i,"").trim();
  } else {
    // score pattern: "Greece 1-0 Portugal" or "Greece 1 x 0 Portugal" or "Greece 1–0 Portugal"
    const scoreRegex = /([\p{L}\s.'\-]+?)\s+\d+\s*[-–—x:]\s*\d+\s+([\p{L}\s.'\-]+)/u;
    const sm = title.match(scoreRegex);
    if(sm){
      homeTeam = cleanTeam(sm[1]);
      awayTeam = cleanTeam(sm[2]);
      // clean awayTeam trailing non-team words
      awayTeam = awayTeam.split(/\s*[|\(\🏆●]/)[0].trim().split(/\s+/).slice(0,3).join(" ").trim();
      homeTeam = homeTeam.split(/\s+/).slice(-3).join(" ").trim(); // take last 2-3 words to avoid prefix like "UEFA EURO 2004 final:"
      // remove prefix like "final:" "UEFA"
      homeTeam = homeTeam.replace(/.*:\s*/,"").trim();
      // if homeTeam still contains tournament words, take last word(s)
      if(/uefa|euro|final/i.test(homeTeam)){
        const parts = homeTeam.split(/\s+/);
        homeTeam = parts.slice(-1).join(" ");
      }
    } else {
      const dash = title.match(/^([\p{L}0-9 .'\-]+?)\s+[-–—]\s+([\p{L}0-9 .'\-]+?)(?:\s*[|\(:]|$)/u);
      if(dash){ homeTeam=cleanTeam(dash[1]); awayTeam=cleanTeam(dash[2]); }
    }
  }
  let year = null;
  const yearMatch = title.match(/\b(19|20)\d{2}(\/\d{2})?\b/);
  if(yearMatch) year = parseInt(yearMatch[0].slice(0,4),10);
  if(!year && opts.fallbackYear) year = opts.fallbackYear;
  let tournament = opts.fallbackTournament || detectTournament(title) || "Football";
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
    .split(/\s+/).slice(0,4).join(" ")
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
  const norm = s=> s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  const yt = norm(ytTitle);
  const homeOk = highlight.homeTeam && yt.includes(norm(highlight.homeTeam));
  const awayOk = highlight.awayTeam && yt.includes(norm(highlight.awayTeam));
  if(!homeOk || !awayOk) return { ok:false, reason:`ytTitle teams mismatch: highlight ${highlight.homeTeam} vs ${highlight.awayTeam} not both in "${ytTitle.slice(0,80)}"`};
  if(!norm(contentFirstLine).includes(norm(highlight.homeTeam)) || !norm(contentFirstLine).includes(norm(highlight.awayTeam)))
    return { ok:false, reason:`content first line mismatch highlight ${highlight.homeTeam} vs ${highlight.awayTeam} not in "${contentFirstLine.slice(0,80)}"`};
  if(watermarkTexts){
    if(!norm(watermarkTexts.matchText).includes(norm(highlight.homeTeam)) || !norm(watermarkTexts.matchText).includes(norm(highlight.awayTeam)))
      return { ok:false, reason:`watermark matchText mismatch`};
    if(!norm(watermarkTexts.tournamentYear).includes(norm(highlight.tournament)) || !String(watermarkTexts.tournamentYear).includes(String(highlight.year)))
      return { ok:false, reason:`watermark tournamentYear mismatch: ${watermarkTexts.tournamentYear} vs ${highlight.tournament} ${highlight.year}`};
  }
  return { ok:true };
}
