import { config } from "./src/config.js";
import { getDiverseBatch, finalToHighlight } from "./src/historical.js";
import { highlightPostedKeys, isAlreadyPosted } from "./src/index.js";
import { pickValidHighlightFromCandidates } from "./src/validate.js";
import { createFacebookPost, extractPostId, verifyPostPublished } from "./src/zernio.js";
import { formatPost } from "./src/formatter.js";
import fs from "fs";

function loadPosted(){
  const set=new Set();
  for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]){
    try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) set.add(k);}catch{}
  }
  return set;
}
function savePosted(set){
  const arr=[...set].sort();
  for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{}
}
function dlWrapper(url,id){
  const {execSync}=awaitImport();
  return null;
}
import { execSync } from "child_process";
async function downloadVideoFile(videoUrl, id){
  if(!videoUrl||!/^https?:\/\//.test(videoUrl)) return null;
  const outPath=`/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g,"_")}.mp4`;
  try{
    console.log(`[video] Downloading ${videoUrl} -> ${outPath}`);
    execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${outPath}" "${videoUrl}" 2>&1 | tail -n 5`, {timeout:120000, encoding:"utf8"});
    if(fs.existsSync(outPath) && fs.statSync(outPath).size>10000){
      console.log(`[video] Downloaded ${Math.round(fs.statSync(outPath).size/1024/1024)}MB`);
      return outPath;
    }
  }catch(e){ console.warn(`[video] err ${e.message?.slice(0,300)}`);}
  return null;
}

const posted=loadPosted();
console.log(`Posted set size ${posted.size}`);

// Get diverse batch filtered by not posted
let picks=[];
let attempts=0;
while(picks.length<4 && attempts<100){
  attempts++;
  const batch=getDiverseBatch(10);
  for(const p of batch){
    const h=finalToHighlight(p.match, "");
    h.tournament=p.tournament; h.year=p.year; h.league=`${p.tournament} ${p.year}`;
    h.homeTeam=p.match.homeTeam; h.awayTeam=p.match.awayTeam;
    h.title=p.title; h.query=p.query; h.source="historical-yt-dlp";
    h.id=`historic-${p.tournament.toLowerCase().replace(/\s+/g,"-")}-${p.year}-${p.match.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${p.match.awayTeam.toLowerCase().replace(/\s+/g,"-")}`;
    if(isAlreadyPosted(h, posted)){
      console.log(`[skip] already posted ${h.id}`);
      continue;
    }
    if(picks.some(x=> x.id===h.id)) continue;
    picks.push(h);
    if(picks.length>=2) break;
  }
}
console.log(`Selected ${picks.length} picks:`);
for(const p of picks) console.log(` - ${p.tournament} ${p.year} ${p.homeTeam} vs ${p.awayTeam} query="${p.query}"`);

for(const h of picks.slice(0,2)){
  console.log(`\n=== Posting ${h.title} ===`);
  const picked = await pickValidHighlightFromCandidates(h.query, h, downloadVideoFile);
  if(!picked){ console.warn(`No valid candidate for ${h.query}, skipping`); continue;}
  const highlight=picked.highlight;
  const videoPath=picked.videoPath;
  console.log(`Using highlight: ${highlight.title} video=${videoPath}`);
  const content=formatPost(highlight);
  if(/youtube\.com|youtu\.be/i.test(content)){ console.warn("youtube link in content skip"); continue;}
  console.log(content);
  const postResult=await createFacebookPost({content, mediaUrls:[videoPath], publishNow:true});
  const postId=extractPostId(postResult);
  console.log(`PostId ${postId} result ${JSON.stringify(postResult).slice(0,500)}`);
  const ver=await verifyPostPublished(postId, {retries:2, delayMs:3000});
  console.log(`Verify: ${JSON.stringify(ver).slice(0,800)}`);
  if(ver.verified){
    console.log(`✓ Verified ${postId}`);
    posted.add(highlight.id);
    for(const k of highlightPostedKeys(highlight)) posted.add(k);
    savePosted(posted);
  } else {
    console.error(`✗ Not verified ${postId}: ${ver.reason}`);
  }
  // delay between posts
  await new Promise(r=>setTimeout(r,3000));
}
console.log("Done");
