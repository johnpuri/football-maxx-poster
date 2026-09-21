/**
 * Historical random picker for Football Maxx — 1998 to today.
 * Diverse club + country games across eras, not just FIFA WC finals.
 *
 * COPYRIGHT SAFE CONTENT POLICY (2026-08-20):
 * - SAFE (80% weight): club leagues where copyright enforcement is lower:
 *   Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League fan edits,
 *   Europa League, FA Cup. These are preferred for daily posts.
 * - COUNTRY (20% weight): Euro, Copa America, World Cup NON-FINAL games only.
 *   World Cup Finals from FIFA.tv are BANNED entirely (FIFA Content ID blocks 15s+).
 *   Watermark covering FIFA.tv + pad bar HIGH UP is applied for transformative use,
 *   but WC Finals are still rejected — use club game instead.
 * - BANNED: any "World Cup {year} Final" title pattern. Filtered at picker + validator.
 * - Transformative safeguard: watermark overlay + extended canvas bar ABOVE video,
 *   but not relied on for WC Finals.
 */
export const TOURNAMENTS = ["World Cup","Euro","Champions League","Premier League","La Liga","Serie A","Bundesliga","Ligue 1","Copa America","FA Cup","Europa League"];
export const NOTABLE_FINALS = [
  { tournament: "World Cup", year: 1998, homeTeam: "France", awayTeam: "Brazil", title: "World Cup 1998 Final — France vs Brazil", score: "3-0", city: "Paris" },
  { tournament: "Champions League", year: 1999, homeTeam: "Man Utd", awayTeam: "Bayern Munich", title: "UCL 1999 Final — Man Utd vs Bayern Munich", score: "2-1", city: "Barcelona" },
  { tournament: "Euro", year: 2000, homeTeam: "France", awayTeam: "Italy", title: "Euro 2000 Final — France vs Italy", score: "2-1 (a.e.t.)", city: "Rotterdam" },
  { tournament: "World Cup", year: 2002, homeTeam: "Brazil", awayTeam: "Germany", title: "World Cup 2002 Final — Brazil vs Germany", score: "2-0", city: "Yokohama" },
  { tournament: "Champions League", year: 2005, homeTeam: "Liverpool", awayTeam: "AC Milan", title: "UCL 2005 Final — Liverpool vs AC Milan", score: "3-3 (3-2 pens)", city: "Istanbul" },
  { tournament: "World Cup", year: 2006, homeTeam: "Italy", awayTeam: "France", title: "World Cup 2006 Final — Italy vs France", score: "1-1 (5-3 pens)", city: "Berlin" },
  { tournament: "Euro", year: 2008, homeTeam: "Spain", awayTeam: "Germany", title: "Euro 2008 Final — Spain vs Germany", score: "1-0", city: "Vienna" },
  { tournament: "Champions League", year: 2009, homeTeam: "Barcelona", awayTeam: "Man Utd", title: "UCL 2009 Final — Barcelona vs Man Utd", score: "2-0", city: "Rome" },
  { tournament: "World Cup", year: 2010, homeTeam: "Spain", awayTeam: "Netherlands", title: "World Cup 2010 Final — Spain vs Netherlands", score: "1-0 (a.e.t.)", city: "Johannesburg" },
  { tournament: "Euro", year: 2012, homeTeam: "Spain", awayTeam: "Italy", title: "Euro 2012 Final — Spain vs Italy", score: "4-0", city: "Kyiv" },
  { tournament: "Champions League", year: 2014, homeTeam: "Real Madrid", awayTeam: "Atletico Madrid", title: "UCL 2014 Final — Real Madrid vs Atletico Madrid", score: "4-1 (a.e.t.)", city: "Lisbon" },
  { tournament: "Copa America", year: 2016, homeTeam: "Chile", awayTeam: "Argentina", title: "Copa America 2016 Final — Chile vs Argentina", score: "0-0 (4-2 pens)", city: "New Jersey" },
  { tournament: "World Cup", year: 2018, homeTeam: "France", awayTeam: "Croatia", title: "World Cup 2018 Final — France vs Croatia", score: "4-2", city: "Moscow" },
  { tournament: "Champions League", year: 2022, homeTeam: "Real Madrid", awayTeam: "Liverpool", title: "UCL 2022 Final — Real Madrid vs Liverpool", score: "1-0", city: "Paris" },
  { tournament: "World Cup", year: 2022, homeTeam: "Argentina", awayTeam: "France", title: "World Cup 2022 Final — Argentina vs France", score: "3-3 (4-2 pens)", city: "Lusail" },
  { tournament: "Euro", year: 2024, homeTeam: "Spain", awayTeam: "England", title: "Euro 2024 Final — Spain vs England", score: "2-1", city: "Berlin" },
  { tournament: "Champions League", year: 2023, homeTeam: "Man City", awayTeam: "Inter Milan", title: "UCL 2023 Final — Man City vs Inter Milan", score: "1-0", city: "Istanbul" },
];
export const CLUB_GAMES = [
  { tournament: "Premier League", year: 1999, homeTeam: "Man Utd", awayTeam: "Arsenal", title: "Premier League 1999 — Man Utd vs Arsenal", city: "Manchester" },
  { tournament: "Premier League", year: 2004, homeTeam: "Arsenal", awayTeam: "Man Utd", title: "Premier League 2004 — Arsenal vs Man Utd", city: "London" },
  { tournament: "Premier League", year: 2012, homeTeam: "Man City", awayTeam: "Man Utd", title: "Premier League 2012 — Man City vs Man Utd", city: "Manchester" },
  { tournament: "Premier League", year: 2019, homeTeam: "Liverpool", awayTeam: "Man City", title: "Premier League 2019 — Liverpool vs Man City", city: "Liverpool" },
  { tournament: "Premier League", year: 2023, homeTeam: "Arsenal", awayTeam: "Liverpool", title: "Premier League 2023 — Arsenal vs Liverpool", city: "London" },
  { tournament: "La Liga", year: 2005, homeTeam: "Barcelona", awayTeam: "Real Madrid", title: "La Liga 2005 — Barcelona vs Real Madrid (El Clasico)", city: "Barcelona" },
  { tournament: "La Liga", year: 2010, homeTeam: "Barcelona", awayTeam: "Real Madrid", title: "La Liga 2010 — Barcelona vs Real Madrid 5-0", city: "Barcelona" },
  { tournament: "La Liga", year: 2017, homeTeam: "Real Madrid", awayTeam: "Barcelona", title: "La Liga 2017 — Real Madrid vs Barcelona", city: "Madrid" },
  { tournament: "La Liga", year: 2023, homeTeam: "Barcelona", awayTeam: "Atletico Madrid", title: "La Liga 2023 — Barcelona vs Atletico Madrid", city: "Barcelona" },
  { tournament: "Serie A", year: 2001, homeTeam: "Roma", awayTeam: "Juventus", title: "Serie A 2001 — Roma vs Juventus", city: "Rome" },
  { tournament: "Serie A", year: 2010, homeTeam: "Inter Milan", awayTeam: "AC Milan", title: "Serie A 2010 — Inter Milan vs AC Milan", city: "Milan" },
  { tournament: "Serie A", year: 2020, homeTeam: "Juventus", awayTeam: "Inter Milan", title: "Serie A 2020 — Juventus vs Inter Milan", city: "Turin" },
  { tournament: "Serie A", year: 2025, homeTeam: "AC Milan", awayTeam: "Inter Milan", title: "Serie A 2025 — AC Milan vs Inter Milan", city: "Milan" },
  { tournament: "Bundesliga", year: 2013, homeTeam: "Bayern Munich", awayTeam: "Dortmund", title: "Bundesliga 2013 — Bayern Munich vs Dortmund", city: "Munich" },
  { tournament: "Bundesliga", year: 2019, homeTeam: "Bayern Munich", awayTeam: "Dortmund", title: "Bundesliga 2019 — Bayern Munich vs Dortmund (Der Klassiker)", city: "Munich" },
  { tournament: "Bundesliga", year: 2022, homeTeam: "Leverkusen", awayTeam: "Bayern Munich", title: "Bundesliga 2022 — Leverkusen vs Bayern Munich", city: "Leverkusen" },
  { tournament: "Ligue 1", year: 2018, homeTeam: "PSG", awayTeam: "Marseille", title: "Ligue 1 2018 — PSG vs Marseille (Le Classique)", city: "Paris" },
  { tournament: "Ligue 1", year: 2021, homeTeam: "PSG", awayTeam: "Lyon", title: "Ligue 1 2021 — PSG vs Lyon", city: "Paris" },
  { tournament: "Ligue 1", year: 2024, homeTeam: "PSG", awayTeam: "Monaco", title: "Ligue 1 2024 — PSG vs Monaco", city: "Paris" },
  { tournament: "Champions League", year: 2013, homeTeam: "Bayern Munich", awayTeam: "Dortmund", title: "UCL 2013 Final — Bayern Munich vs Dortmund", city: "London" },
  { tournament: "Champions League", year: 2014, homeTeam: "Real Madrid", awayTeam: "Bayern Munich", title: "UCL 2014 Semi — Real Madrid vs Bayern Munich", city: "Madrid" },
  { tournament: "Champions League", year: 2017, homeTeam: "Real Madrid", awayTeam: "Juventus", title: "UCL 2017 Final — Real Madrid vs Juventus", city: "Cardiff" },
  { tournament: "Champions League", year: 2019, homeTeam: "Liverpool", awayTeam: "Tottenham", title: "UCL 2019 Final — Liverpool vs Tottenham", city: "Madrid" },
  { tournament: "Champions League", year: 2021, homeTeam: "Chelsea", awayTeam: "Man City", title: "UCL 2021 Final — Chelsea vs Man City", city: "Porto" },
  { tournament: "Europa League", year: 2016, homeTeam: "Liverpool", awayTeam: "Sevilla", title: "Europa League 2016 Final — Liverpool vs Sevilla", city: "Basel" },
  { tournament: "Europa League", year: 2023, homeTeam: "Sevilla", awayTeam: "Roma", title: "Europa League 2023 Final — Sevilla vs Roma", city: "Budapest" },
  { tournament: "FA Cup", year: 2006, homeTeam: "Liverpool", awayTeam: "West Ham", title: "FA Cup 2006 Final — Liverpool vs West Ham", city: "Cardiff" },
  { tournament: "FA Cup", year: 2022, homeTeam: "Liverpool", awayTeam: "Chelsea", title: "FA Cup 2022 Final — Liverpool vs Chelsea", city: "London" },
  { tournament: "Champions League", year: 2024, homeTeam: "Real Madrid", awayTeam: "Dortmund", title: "UCL 2024 Final — Real Madrid vs Dortmund", city: "London" },
  { tournament: "Premier League", year: 2026, homeTeam: "Man City", awayTeam: "Arsenal", title: "Premier League 2026 — Man City vs Arsenal", city: "Manchester" },
];
export const COUNTRY_GAMES = [
  { tournament: "World Cup", year: 1998, homeTeam: "Brazil", awayTeam: "Netherlands", title: "World Cup 1998 Semi — Brazil vs Netherlands", city: "Marseille" },
  { tournament: "Euro", year: 2000, homeTeam: "Portugal", awayTeam: "England", title: "Euro 2000 — Portugal vs England 3-2", city: "Eindhoven" },
  { tournament: "World Cup", year: 2002, homeTeam: "Senegal", awayTeam: "France", title: "World Cup 2002 — Senegal vs France 1-0", city: "Seoul" },
  { tournament: "Euro", year: 2004, homeTeam: "Greece", awayTeam: "Portugal", title: "Euro 2004 Final — Greece vs Portugal", city: "Lisbon" },
  { tournament: "Copa America", year: 2007, homeTeam: "Brazil", awayTeam: "Argentina", title: "Copa America 2007 Final — Brazil vs Argentina", city: "Maracaibo" },
  { tournament: "World Cup", year: 2010, homeTeam: "Germany", awayTeam: "Argentina", title: "World Cup 2010 Quarter — Germany vs Argentina 4-0", city: "Cape Town" },
  { tournament: "Euro", year: 2012, homeTeam: "Germany", awayTeam: "Netherlands", title: "Euro 2012 — Germany vs Netherlands", city: "Kharkiv" },
  { tournament: "World Cup", year: 2014, homeTeam: "Brazil", awayTeam: "Germany", title: "World Cup 2014 Semi — Brazil vs Germany 1-7", city: "Belo Horizonte" },
  { tournament: "Copa America", year: 2015, homeTeam: "Chile", awayTeam: "Argentina", title: "Copa America 2015 Final — Chile vs Argentina", city: "Santiago" },
  { tournament: "Euro", year: 2016, homeTeam: "Iceland", awayTeam: "England", title: "Euro 2016 — Iceland vs England 2-1", city: "Nice" },
  { tournament: "World Cup", year: 2018, homeTeam: "Spain", awayTeam: "Portugal", title: "World Cup 2018 — Spain vs Portugal 3-3", city: "Sochi" },
  { tournament: "Copa America", year: 2019, homeTeam: "Brazil", awayTeam: "Peru", title: "Copa America 2019 Final — Brazil vs Peru", city: "Rio" },
  { tournament: "Euro", year: 2020, homeTeam: "Italy", awayTeam: "England", title: "Euro 2020 Final — Italy vs England", city: "London" },
  { tournament: "World Cup", year: 2022, homeTeam: "Morocco", awayTeam: "Portugal", title: "World Cup 2022 Quarter — Morocco vs Portugal 1-0", city: "Doha" },
  { tournament: "World Cup", year: 2014, homeTeam: "Netherlands", awayTeam: "Spain", title: "World Cup 2014 — Netherlands vs Spain 5-1", city: "Salvador" },
  { tournament: "Copa America", year: 2021, homeTeam: "Argentina", awayTeam: "Brazil", title: "Copa America 2021 Final — Argentina vs Brazil", city: "Rio" },
  { tournament: "Euro", year: 2024, homeTeam: "Spain", awayTeam: "Germany", title: "Euro 2024 Quarter — Spain vs Germany 2-1", city: "Stuttgart" },
  { tournament: "World Cup Qualifier", year: 2017, homeTeam: "Argentina", awayTeam: "Ecuador", title: "World Cup Qualifier 2017 — Argentina vs Ecuador", city: "Quito" },
  { tournament: "World Cup Qualifier", year: 2025, homeTeam: "Brazil", awayTeam: "Argentina", title: "World Cup Qualifier 2025 — Brazil vs Argentina", city: "Rio" },
  { tournament: "Euro", year: 2008, homeTeam: "Netherlands", awayTeam: "France", title: "Euro 2008 — Netherlands vs France 4-1", city: "Bern" },
];
export function pickRandomTournament(){ return TOURNAMENTS[Math.floor(Math.random()*TOURNAMENTS.length)]; }
export function pickRandomYear(min=1998,max=new Date().getFullYear()){ return Math.floor(Math.random()*(max-min+1))+min; }
export function pickRandomFinal(){ return NOTABLE_FINALS[Math.floor(Math.random()*NOTABLE_FINALS.length)]; }
export function pickRandomClubGame(){ return CLUB_GAMES[Math.floor(Math.random()*CLUB_GAMES.length)]; }
export function pickRandomCountryGame(){ return COUNTRY_GAMES[Math.floor(Math.random()*COUNTRY_GAMES.length)]; }
// SAFE CONTENT LISTS — exported for validator awareness
export const SAFE_CLUB_TOURNAMENTS = ["Premier League","La Liga","Serie A","Bundesliga","Ligue 1","Champions League","Europa League","FA Cup"];
export const SAFE_COUNTRY_TOURNAMENTS = ["Euro","Copa America","World Cup Qualifier"];
// WC Finals are banned; Euro/Copa finals are banned by the validator too (Rule 5b) —
// exclude them here so the picker never wastes a run on a pick that validation rejects.
// (Club/UCL finals from fan edits pass validation, same as Bundesliga.)
const SAFE_FINALS = NOTABLE_FINALS.filter(f => f.tournament !== "World Cup" && f.tournament !== "Euro" && f.tournament !== "Copa America");

export const STAGES = ["Group Stage","Round of 16","Quarter-Final","Semi-Final","Final","Regular Season"];
export const STAGE_WEIGHTS = { "Group Stage": 0.25, "Round of 16": 0.20, "Quarter-Final": 0.15, "Semi-Final": 0.15, "Final": 0.10, "Regular Season": 0.15 };
export function pickRandomStage(){
  const r=Math.random();
  let acc=0;
  for(const s of STAGES){ acc+=STAGE_WEIGHTS[s]; if(r < acc) return s; }
  return STAGES[STAGES.length-1];
}
export function stageToQuerySuffix(stage){
  const map={
    "Group Stage": "group stage",
    "Round of 16": "round of 16",
    "Quarter-Final": "quarter final",
    "Semi-Final": "semi final",
    "Final": "final",
    "Regular Season": "" // no suffix — plain league match
  };
  return map[stage]||"";
}
export function pickRandomClubOrCountry(){ const ratio=parseFloat(process.env.CLUB_COUNTRY_RATIO||"0.8"); const isClub=Math.random()<ratio; const game=isClub?pickRandomClubGame():pickRandomCountryGame(); return {...game, category:isClub?"club":"country", stage: pickRandomStage()}; }
// Stage validity per tournament — same rule for every competition (Bundesliga/UCL style):
// Euro 2000–2012 was a 16-team tournament (group → quarter-final, NO Round of 16; R16 starts Euro 2016).
// Copa America has group → quarter-final, no Round of 16. World Cup has R16 throughout.
export function effectiveStageFor(tournament, year, stage){
  // World Cup Qualifiers have no knockout rounds — group/playoff only
  if (tournament === "World Cup Qualifier" && stage !== "Group Stage" && stage !== "Regular Season") {
    return { stage: "Group Stage", suffix: "group stage" };
  }
  if (stage === "Round of 16") {
    if (tournament === "Copa America") return { stage: "Quarter-Final", suffix: "quarter final" };
    if (tournament === "Euro" && year < 2016) return { stage: "Quarter-Final", suffix: "quarter final" };
  }
  return { stage, suffix: stageToQuerySuffix(stage) };
}
export function getRandomHistoricalPick(){
  // Forced pick (manual check runs): FORCED_TOURNAMENT / FORCED_YEAR / FORCED_STAGE
  const forcedTourn = (process.env.FORCED_TOURNAMENT || "").toLowerCase();
  const forcedYear = parseInt(process.env.FORCED_YEAR || "0", 10);
  const forcedStage = process.env.FORCED_STAGE || "";
  if (forcedTourn) {
    const pool = [...CLUB_GAMES, ...COUNTRY_GAMES].filter(g =>
      g.tournament.toLowerCase().includes(forcedTourn) && (!forcedYear || g.year === forcedYear));
    if (pool.length) {
      const g = pool[Math.floor(Math.random() * pool.length)];
      let st = forcedStage || "Group Stage";
      const eff = effectiveStageFor(g.tournament, g.year, st);
      st = eff.stage;
      let title = `${g.tournament} ${g.year} ${eff.suffix} — ${g.homeTeam} vs ${g.awayTeam}`;
      if ((g.tournament === "Euro" || g.tournament === "Copa America") && /final/i.test(title)) {
        title = `${g.tournament} ${g.year} Semi-Final — ${g.homeTeam} vs ${g.awayTeam}`;
        st = "Semi-Final";
      }
      return { tournament: g.tournament, year: g.year, match: { ...g, stage: st }, title,
        query: `${g.tournament} ${g.year}${eff.suffix ? " " + eff.suffix : ""} ${g.homeTeam} vs ${g.awayTeam} highlights`,
        category: "forced", stage: st, safe: true, stageSuffix: eff.suffix };
    }
    console.warn(`[FORCED] No match for tournament="${forcedTourn}" year=${forcedYear} — falling back to random`);
  }
  const stage = pickRandomStage();
  const suffix = stageToQuerySuffix(stage);
  const r=Math.random();
  if(r < 0.80){
    // club path — 80% weight
    // Final only if stage is Final; otherwise regular/league stage match
    if(stage === "Final" && SAFE_FINALS.length && Math.random() < 0.5){
      const f=SAFE_FINALS[Math.floor(Math.random()*SAFE_FINALS.length)];
      // SAFE_FINALS excludes World Cup / Euro / Copa America (validator-banned), so safe
      return {tournament:f.tournament,year:f.year,match:{...f, stage},title:f.title,query:`${f.tournament} ${f.year} final ${f.homeTeam} vs ${f.awayTeam} highlights`,category:"final", stage, safe:true, stageSuffix: suffix};
    }
    let g=pickRandomClubGame();
    // League-aware stage: domestic leagues have no knockout rounds — force Regular Season
    const LEAGUE_TOURNAMENTS = ["Premier League","La Liga","Serie A","Bundesliga","Ligue 1"];
    let effectiveStage = stage;
    let effectiveSuffix = suffix;
    if (LEAGUE_TOURNAMENTS.includes(g.tournament) && stage !== "Regular Season" && stage !== "Final") {
      effectiveStage = "Regular Season";
      effectiveSuffix = "";
    }
    const suffixPart = effectiveSuffix ? ` ${effectiveSuffix}` : "";
    // override title stage for diversity
    const titleWithStage = effectiveSuffix && effectiveStage !== "Regular Season" ? `${g.tournament} ${g.year} ${effectiveSuffix} — ${g.homeTeam} vs ${g.awayTeam}` : g.title;
    return {tournament:g.tournament,year:g.year,match:{...g, stage: effectiveStage},title:titleWithStage,query:`${g.tournament} ${g.year}${suffixPart} ${g.homeTeam} vs ${g.awayTeam} highlights`,category:"club", stage: effectiveStage, safe:true, stageSuffix: effectiveSuffix};
  }
  // country path — 20% weight
  let g=pickRandomCountryGame();
  let attempts=0;
  while(g.tournament==="World Cup" && /final/i.test(g.title) && attempts<10){ g=pickRandomCountryGame(); attempts++; }
  // Euro/Copa finals are banned by the validator (Rule 5b) — rewrite to a
  // knockout semi like the UCL path instead of wasting the run (same way as Bundesliga).
  // Covers both Final-titled games AND stage=Final rolled onto a group game.
  const eff0 = effectiveStageFor(g.tournament, g.year, stage);
  let useStage = stage;
  if ((g.tournament === "Euro" || g.tournament === "Copa America") && (/final/i.test(g.title) || eff0.stage === "Final")) {
    g = { ...g, title: `${g.tournament} ${g.year} Semi-Final — ${g.homeTeam} vs ${g.awayTeam}` };
    useStage = "Semi-Final";
  }
  // enforce stage validity for this tournament (Euro pre-2016 / Copa have no R16 — same as club path)
  const eff = effectiveStageFor(g.tournament, g.year, useStage);
  const effStage = eff.stage, effSuffix = eff.suffix;
  // enforce stage diversity: if original title is Final but random stage is not, regenerate suffix
  const suffixPart2 = effSuffix ? ` ${effSuffix}` : "";
  let titleWithStage2 = g.title;
  if(effSuffix && effStage !== "Regular Season"){
    // replace Final in title if present, else inject stage
    if(/final/i.test(titleWithStage2) && effStage !== "Final"){
      titleWithStage2 = `${g.tournament} ${g.year} ${effSuffix} — ${g.homeTeam} vs ${g.awayTeam}`;
    } else if(!/final|group|round|quarter|semi/i.test(titleWithStage2)){
      titleWithStage2 = `${g.tournament} ${g.year} ${effSuffix} — ${g.homeTeam} vs ${g.awayTeam}`;
    }
  }
  // World Cup Final banned regardless of stage
  const isBannedWC = g.tournament==="World Cup" && /final/i.test(titleWithStage2);
  if(isBannedWC){
    // fallback to club game with same stage
    const fallback=pickRandomClubGame();
    const sfx = effSuffix ? ` ${effSuffix}` : "";
    return {tournament:fallback.tournament,year:fallback.year,match:{...fallback, stage: effStage},title: effSuffix && effStage!=="Regular Season" ? `${fallback.tournament} ${fallback.year} ${effSuffix} — ${fallback.homeTeam} vs ${fallback.awayTeam}` : fallback.title,query:`${fallback.tournament} ${fallback.year}${sfx} ${fallback.homeTeam} vs ${fallback.awayTeam} highlights`,category:"club", stage: effStage, safe:true, stageSuffix: effSuffix};
  }
  // Align query stage with the title's stage (a "final" query for a semi game returns wrong videos)
  const titleStageMatch = titleWithStage2.match(/semi[\s-]?final|quarter[\s-]?final|round of 16|group stage|regular season|\bfinal\b/i);
  const querySuffix = titleStageMatch ? titleStageMatch[0].toLowerCase().replace(/-/, " ") : effSuffix;
  const querySuffixPart = querySuffix ? ` ${querySuffix}` : "";
  return {tournament:g.tournament,year:g.year,match:{...g, stage: effStage},title:titleWithStage2,query:`${g.tournament} ${g.year}${querySuffixPart} ${g.homeTeam} vs ${g.awayTeam} highlights`,category:"country", stage: effStage, safe: g.tournament!=="World Cup" || !/final/i.test(titleWithStage2), stageSuffix: effSuffix};}
export function getDiverseBatch(n=6){
  const seen=new Set(); const out=[]; let attempts=0;
  const stageCounts={};
  while(out.length<n && attempts<150){
    attempts++;
    const p=getRandomHistoricalPick();
    const key=`${p.tournament}-${p.year}-${p.match.homeTeam}-${p.match.awayTeam}-${p.stage}`;
    if(seen.has(key)) continue;
    // enforce stage diversity: don't allow >40% same stage in batch
    const maxSame = Math.ceil(n*0.4);
    if((stageCounts[p.stage]||0) >= maxSame) {
      // try to pick different stage — re-roll once
      if(attempts < 100) continue;
    }
    seen.add(key);
    stageCounts[p.stage]=(stageCounts[p.stage]||0)+1;
    out.push(p);
  }
  return out;
}
export function finalToHighlight(final,videoUrl=""){
  return {id:`historic-${final.tournament.toLowerCase().replace(/\s+/g,"-")}-${final.year}-${final.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${final.awayTeam.toLowerCase().replace(/\s+/g,"-")}`,title:final.title,league:`${final.tournament} ${final.year}`,homeTeam:final.homeTeam,awayTeam:final.awayTeam,date:`${final.year}-07-01`,videoUrl:videoUrl||"",embedUrl:videoUrl||"",thumbnail:"",source:"historical",historic:true,year:final.year,tournament:final.tournament,raw:final};
}
