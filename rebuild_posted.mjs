import { config } from "./src/config.js";
import fs from "fs";
const res = await fetch(`${config.zernioBaseUrl}/posts?limit=100`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
const j = await res.json();
const posts = j.posts||j.data||[];
const published = posts.filter(p=>p.status==="published");
console.log(`published ${published.length}`);

function normalizeTeam(s){ return s.toLowerCase().replace(/[^a-z0-9]/g,""); }
function parsePublished(content){
  const lines = content.split("\n");
  const title = lines[0]||"";
  const tourneyLine = lines[1]||"";
  // year from tourneyLine or title
  const yearM = (tourneyLine+" "+title).match(/\b(19|20)\d{2}\b/);
  const year = yearM? yearM[0]:"";
  const tourneyM = tourneyLine.replace(/🏆/g,"").trim();
  // teams: find " vs " or " v " or " - " in title
  let home="", away="";
  // try vs pattern case-insensitive
  const vsPatterns = [/\s+vs\.?\s+/i, /\s+v\s+/i, /\s*—\s*/];
  let match=null;
  for(const pat of vsPatterns){
    if(pat.test(title)) { match=title.split(pat); break; }
  }
  if(match && match.length>=2){
    // home is after removing leading emoji etc
    home = match[0].replace(/^[^\w]+/,"").trim().split(/[\|\-:,\(]/)[0].trim();
    away = match[1].trim().split(/[\|\-:,\(]/)[0].trim();
    // clean "highlights" etc trailing: take first 2 words max? Actually keep teams may be 2 words e.g. Real Madrid
    // For "Real Madrid vs Dortmund Highlights" we want away="Dortmund"
    // So take first relevant team words before common keywords
    away = away.split(/\s+(highlights|final|semi|quarter|group|classic|live|hd)\b/i)[0].trim();
    home = home.split(/\b(highlights|classic|hd|final)\b/i).pop().trim();
    // home may contain prefix like "UCL 2024 Final — Real Madrid" -> take last team phrase after year
    // extract last occurrence of team before vs
    // Simplify: extract using known teams list via historical lookup? but just keep last 2 words
    // Better: if home contains year, extract after year
    const yearInHome = home.match(/\b(19|20)\d{2}\b/);
    if(yearInHome){
      const idx = home.indexOf(yearInHome[0])+yearInHome[0].length;
      home = home.slice(idx).replace(/^[^a-zA-Z]+/,"").trim().split(/\s+final|\s+semi|\s+quarter|\s+group|\s+round/i)[0].trim();
    }
  }
  return { title, tourneyLine: tourneyM, year, home, away };
}

for(const p of published.slice(0,20)){
  const pr = parsePublished(p.content);
  console.log(`title: "${pr.title.slice(0,80)}" => home="${pr.home}" away="${pr.away}" tourney="${pr.tourneyLine}" year="${pr.year}"`);
}

// Build robust posted set matching historical highlight id generation
const postedSet = new Set();
for(const p of published){
  const pr = parsePublished(p.content);
  if(pr.home && pr.away && pr.year){
    const h = normalizeTeam(pr.home);
    const a = normalizeTeam(pr.away);
    const tNorm = pr.tourneyLine.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9\-]/g,"");
    // canonical highlight id style
    postedSet.add(`historic-${tNorm}-${pr.year}-${h}-vs-${a}`);
    postedSet.add(`historic-${tNorm}-${pr.year}-${a}-vs-${h}`);
    // key home vs away + year + tournament
    const tourKey = tNorm;
    postedSet.add(`${h}_vs_${a}_${pr.year}_${tourKey}`);
    postedSet.add(`${a}_vs_${h}_${pr.year}_${tourKey}`);
    postedSet.add(`${h}_vs_${a}_${pr.year}`);
    postedSet.add(`${a}_vs_${h}_${pr.year}`);
  }
}
// load existing posted.json
try{ const existing=JSON.parse(fs.readFileSync("posted.json","utf8")); for(const e of existing) postedSet.add(e);}catch{}
try{ const s2=JSON.parse(fs.readFileSync("src/posted.json","utf8")); for(const e of s2) postedSet.add(e);}catch{}

const arr=[...postedSet].sort();
fs.writeFileSync("/tmp/posted_set.json", JSON.stringify(arr,null,2));
fs.writeFileSync("src/posted.json", JSON.stringify(arr,null,2));
fs.writeFileSync("posted.json", JSON.stringify(arr,null,2));
console.log(`\nSaved ${arr.length} keys to posted.json, src/posted.json, /tmp/posted_set.json`);
console.log(arr.slice(0,30).join("\n"));

// Also show which historical games are NOT in posted set
import { CLUB_GAMES, COUNTRY_GAMES, NOTABLE_FINALS } from "./src/historical.js";
function teamNorm(s){ return s.toLowerCase().replace(/[^a-z0-9]/g,""); }
function isPosted(game){
  const h=teamNorm(game.homeTeam), a=teamNorm(game.awayTeam);
  const tNorm=game.tournament.toLowerCase().replace(/\s+/g,"-");
  const keys=[`historic-${tNorm}-${game.year}-${h}-vs-${a}`, `${h}_vs_${a}_${game.year}_${tNorm}`, `${h}_vs_${a}_${game.year}`];
  return keys.some(k=> postedSet.has(k) || arr.some(x=> x.includes(h) && x.includes(a) && x.includes(String(game.year))));
}
console.log("\n--- CLUB_GAMES not posted ---");
for(const g of CLUB_GAMES){ if(!isPosted(g)) console.log(`${g.tournament} ${g.year} ${g.homeTeam} vs ${g.awayTeam}`); }
console.log("\n--- COUNTRY_GAMES not posted ---");
for(const g of COUNTRY_GAMES){ if(!isPosted(g)) console.log(`${g.tournament} ${g.year} ${g.homeTeam} vs ${g.awayTeam}`); }
