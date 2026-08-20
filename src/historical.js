/**
 * Historical random picker for Football Maxx — 1998 to today.
 * Provides tournament list, notable finals, and random selection helpers.
 * Used by src/index.js when HISTORICAL_MODE / RANDOM_HISTORICAL is enabled.
 */

export const TOURNAMENTS = [
  "World Cup",
  "Euro",
  "Champions League",
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Copa America",
  "FA Cup",
];

// 15+ notable finals spanning 1998-2026. Each has exact year for header accuracy.
export const NOTABLE_FINALS = [
  { tournament: "World Cup",        year: 1998, homeTeam: "France",    awayTeam: "Brazil",     title: "World Cup 1998 Final — France vs Brazil",            score: "3-0", city: "Paris" },
  { tournament: "Champions League", year: 1999, homeTeam: "Man Utd",   awayTeam: "Bayern Munich", title: "UCL 1999 Final — Man Utd vs Bayern Munich",      score: "2-1", city: "Barcelona" },
  { tournament: "Euro",             year: 2000, homeTeam: "France",    awayTeam: "Italy",      title: "Euro 2000 Final — France vs Italy",                  score: "2-1 (a.e.t.)", city: "Rotterdam" },
  { tournament: "World Cup",        year: 2002, homeTeam: "Brazil",    awayTeam: "Germany",    title: "World Cup 2002 Final — Brazil vs Germany",           score: "2-0", city: "Yokohama" },
  { tournament: "Champions League", year: 2005, homeTeam: "Liverpool", awayTeam: "AC Milan",   title: "UCL 2005 Final — Liverpool vs AC Milan",             score: "3-3 (3-2 pens)", city: "Istanbul" },
  { tournament: "World Cup",        year: 2006, homeTeam: "Italy",     awayTeam: "France",     title: "World Cup 2006 Final — Italy vs France",             score: "1-1 (5-3 pens)", city: "Berlin" },
  { tournament: "Euro",             year: 2008, homeTeam: "Spain",     awayTeam: "Germany",    title: "Euro 2008 Final — Spain vs Germany",                 score: "1-0", city: "Vienna" },
  { tournament: "Champions League", year: 2009, homeTeam: "Barcelona", awayTeam: "Man Utd",    title: "UCL 2009 Final — Barcelona vs Man Utd",              score: "2-0", city: "Rome" },
  { tournament: "World Cup",        year: 2010, homeTeam: "Spain",     awayTeam: "Netherlands",title: "World Cup 2010 Final — Spain vs Netherlands",        score: "1-0 (a.e.t.)", city: "Johannesburg" },
  { tournament: "Euro",             year: 2012, homeTeam: "Spain",     awayTeam: "Italy",      title: "Euro 2012 Final — Spain vs Italy",                   score: "4-0", city: "Kyiv" },
  { tournament: "Champions League", year: 2014, homeTeam: "Real Madrid", awayTeam: "Atletico Madrid", title: "UCL 2014 Final — Real Madrid vs Atletico Madrid", score: "4-1 (a.e.t.)", city: "Lisbon" },
  { tournament: "Copa America",     year: 2016, homeTeam: "Chile",     awayTeam: "Argentina",  title: "Copa America 2016 Final — Chile vs Argentina",       score: "0-0 (4-2 pens)", city: "New Jersey" },
  { tournament: "World Cup",        year: 2018, homeTeam: "France",    awayTeam: "Croatia",    title: "World Cup 2018 Final — France vs Croatia",           score: "4-2", city: "Moscow" },
  { tournament: "Champions League", year: 2022, homeTeam: "Real Madrid", awayTeam: "Liverpool", title: "UCL 2022 Final — Real Madrid vs Liverpool",         score: "1-0", city: "Paris" },
  { tournament: "World Cup",        year: 2022, homeTeam: "Argentina", awayTeam: "France",     title: "World Cup 2022 Final — Argentina vs France",         score: "3-3 (4-2 pens)", city: "Lusail" },
  { tournament: "Euro",             year: 2024, homeTeam: "Spain",     awayTeam: "England",    title: "Euro 2024 Final — Spain vs England",                 score: "2-1", city: "Berlin" },
  { tournament: "Champions League", year: 2023, homeTeam: "Man City",  awayTeam: "Inter Milan",title: "UCL 2023 Final — Man City vs Inter Milan",           score: "1-0", city: "Istanbul" },
];

export function pickRandomTournament() {
  return TOURNAMENTS[Math.floor(Math.random() * TOURNAMENTS.length)];
}

export function pickRandomYear(min = 1998, max = new Date().getFullYear()) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandomFinal() {
  return NOTABLE_FINALS[Math.floor(Math.random() * NOTABLE_FINALS.length)];
}

/**
 * Combined random historical pick.
 * With ~50% chance returns a notable final (accurate metadata), otherwise
 * a random tournament+year combo for broader coverage.
 */
export function getRandomHistoricalPick() {
  const useFinal = Math.random() < 0.6;
  if (useFinal) {
    const f = pickRandomFinal();
    return {
      tournament: f.tournament,
      year: f.year,
      match: f,
      title: f.title,
      query: `${f.tournament} ${f.year} final ${f.homeTeam} vs ${f.awayTeam} highlights`,
    };
  }
  const tournament = pickRandomTournament();
  const year = pickRandomYear(1998, 2026);
  return {
    tournament,
    year,
    match: null,
    title: `${tournament} ${year} highlights`,
    query: `${tournament} ${year} highlights`,
  };
}

/**
 * Build a synthetic highlight object from a notable final — used when
 * Highlightly/ScoreBat have no archival match for that year and we fall back
 * to yt-dlp YouTube search.
 */
export function finalToHighlight(final, videoUrl = "") {
  return {
    id: `historic-${final.tournament.toLowerCase().replace(/\s+/g, "-")}-${final.year}-${final.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${final.awayTeam.toLowerCase().replace(/\s+/g,"-")}`,
    title: final.title,
    league: `${final.tournament} ${final.year}`,
    homeTeam: final.homeTeam,
    awayTeam: final.awayTeam,
    date: `${final.year}-07-01`,
    videoUrl: videoUrl || "",
    embedUrl: videoUrl || "",
    thumbnail: "",
    source: "historical",
    historic: true,
    year: final.year,
    tournament: final.tournament,
    raw: final,
  };
}
