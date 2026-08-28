import { config } from "./src/config.js";
import fs from "fs";
const res = await fetch(`${config.zernioBaseUrl}/posts?limit=100`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
const j = await res.json();
const posts = j.posts || j.data || [];
console.log(`Total posts: ${posts.length}`);

function extractKey(content){
  // content format: "⚽ Title\n🏆 Tournament Year\n..."
  // Extract year, tournament, teams
  const lines = content.split("\n");
  const titleLine = lines[0] || "";
  const tourneyLine = lines[1] || "";
  // tournament line: "🏆 Euro 2000" or "🏆 Premier League 2012"
  // year is 4-digit
  const yearMatch = (tourneyLine + " " + titleLine).match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "unknown";
  // teams: extract from titleLine vs pattern "X vs Y"
  const vsMatch = titleLine.match(/(.+?)\s+vs\.?\s+(.+)/i);
  let home="", away="";
  if(vsMatch){
    // clean emojis, titles
    home = vsMatch[1].replace(/^[^a-zA-Z0-9]+/, "").trim().toLowerCase().replace(/[^a-z0-9]/g,"");
    away = vsMatch[2].split(/[\|\-—\(]/)[0].trim().toLowerCase().replace(/[^a-z0-9]/g,"");
    // for bidirectional key, sort? Task says home vs away + year + tournament - keep directional but normalize
  }
  const tourneyNorm = tourneyLine.replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
  // Also derive tournament from tourneyLine
  return { rawTitle: titleLine, rawTourney: tourneyLine, year, home, away, tourneyNorm };
}

const published = posts.filter(p=>p.status==="published");
console.log(`Published: ${published.length}`);
for (const p of published) {
  const k = extractKey(p.content);
  console.log(`- ${k.rawTitle.slice(0,80)} | ${k.rawTourney} | teams: ${k.home} vs ${k.away} | year ${k.year} | status ${p.status}`);
}

// Build posted set keys: home|away|year|tournamentNorm and also sorted variant + id style keys
const postedSet = new Set();
for (const p of published) {
  const k = extractKey(p.content);
  // primary key: home vs away + year + tournament
  if(k.home && k.away && k.year) {
    postedSet.add(`${k.home}_vs_${k.away}_${k.year}_${k.tourneyNorm}`);
    // also reverse to catch same fixture swapped
    postedSet.add(`${k.away}_vs_${k.home}_${k.year}_${k.tourneyNorm}`);
    // also generic without tournament norm but with year
    postedSet.add(`${k.home}_vs_${k.away}_${k.year}`);
    postedSet.add(`${k.away}_vs_${k.home}_${k.year}`);
  }
  // also extract from NOTABLE_FINALS style id
  // e.g. historic-euro-2000-france-vs-italy
  if(k.home && k.away){
    postedSet.add(`historic-${k.tourneyNorm}-${k.year}-${k.home}-vs-${k.away}`);
  }
}

// Also load existing posted.json
try{
  const existing = JSON.parse(fs.readFileSync("posted.json","utf8"));
  console.log("existing posted.json:", existing);
  for(const e of existing) postedSet.add(e);
}catch{}

// Save to /tmp/posted_set.json and src/posted.json and posted.json updated
const arr = [...postedSet].sort();
fs.writeFileSync("/tmp/posted_set.json", JSON.stringify(arr,null,2));
fs.writeFileSync("src/posted.json", JSON.stringify(arr,null,2));
console.log(`\nSaved posted set: ${arr.length} keys to /tmp/posted_set.json and src/posted.json`);
console.log(arr.slice(0,20).join("\n"));

// Show full content list for debugging
console.log("\n--- ALL PUBLISHED CONTENTS ---");
for(const p of published){
  console.log(p.content.replace(/\n/g," | ").slice(0,200));
}
