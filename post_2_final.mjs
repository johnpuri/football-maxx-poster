import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";

function getDuration(p){ try{ const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim(); return parseFloat(o);}catch{ return null; } }
function ensureProfilePic(){ const p="/tmp/page_profile.jpg"; if(fs.existsSync(p) && fs.statSync(p).size>1000) return p; execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`); return p; }
async function presignUpload(fp){
  const fn=path.basename(fp); const sz=fs.statSync(fp).size;
  const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify({filename:fn, contentType:"video/mp4", size:sz})});
  const t=await r.text(); if(!r.ok) throw new Error(`presign ${r.status}: ${t.slice(0,800)}`); const j=JSON.parse(t);
  const up=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl; const pub=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;
  if(!up) throw new Error(`no uploadUrl ${t.slice(0,500)}`); const finalPub=pub||up.split('?')[0];
  const buf=fs.readFileSync(fp); const put=await fetch(up,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`); return finalPub;
}
async function createReel(content, mediaUrl){
  const body={content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}]};
  const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const t=await r.text(); let j; try{j=JSON.parse(t);}catch{j={raw:t}}; if(!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j).slice(0,800)}`); return j;
}
function downloadYt(id, out){
  console.log(`downloading ${id} -> ${out}`);
  execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist -o "${out}" "https://www.youtube.com/watch?v=${id}" 2>&1 | tail -n 5`, {timeout:120000, encoding:"utf8"});
}
function trimToRange(inp, out, target=150){
  execSync(`ffmpeg -y -ss 0 -t ${target} -i "${inp}" -c copy "${out}" 2>/dev/null || ffmpeg -y -ss 0 -t ${target} -i "${inp}" -c:v libx264 -c:a aac "${out}" 2>/dev/null`, {timeout:60000});
  return out;
}
function loadPosted(){
  const set=new Set();
  for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) set.add(k);}catch{}
  return set;
}
function savePosted(set){
  const arr=[...set].sort();
  for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{}
}
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function isPostedCandidate(c, posted){
  const ht=normalizeTeam(c.homeTeam), at=normalizeTeam(c.awayTeam);
  const tNorm=c.tournament.toLowerCase().replace(/\s+/g,"-");
  const keys=[`historic-${tNorm}-${c.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${c.year}_${tNorm}`, `${ht}_vs_${at}_${c.year}`];
  return keys.some(k=> posted.has(k));
}

// 2 diverse not in posted set — pick from unposted list identified earlier
// Filter: must have logo HIGH UP, single source fan highlights, triple-match, 2-3 min native
const allCandidates=[
  // Ligue 1 2018 PSG vs Marseille — not posted
  { id:"gDO1E_yNkv0", ytTitle:"Kylian Mbappe scores as PSG beats Marseille in Le Classique | Ligue 1 Highlights", tournament:"Ligue 1", year:2018, homeTeam:"PSG", awayTeam:"Marseille", stage:"Regular Season" },
  // World Cup 2014 Brazil vs Germany 1-7 — not posted
  { id:"lO1MyBvJ0S8", ytTitle:"Brazil 1-7 Germany World Cup 2014 Semi Final Highlights", tournament:"World Cup", year:2014, homeTeam:"Brazil", awayTeam:"Germany", stage:"Semi-Final" },
  // Premier League 2023 Arsenal vs Liverpool — not posted
  { id:"n2w4Vh9kX8Q", ytTitle:"Arsenal vs Liverpool Premier League 2023 Highlights", tournament:"Premier League", year:2023, homeTeam:"Arsenal", awayTeam:"Liverpool", stage:"Regular Season" },
  // Serie A 2010 Inter vs AC Milan — not posted
  { id:"7YyOTvPR950", ytTitle:"MILAN-INTER Highlights Serie A 2010", tournament:"Serie A", year:2010, homeTeam:"Inter Milan", awayTeam:"AC Milan", stage:"Regular Season" },
  // Bundesliga 2019 Bayern vs Dortmund
  { id:"u5QeCJHkX7E", ytTitle:"Bayern Munich vs Borussia Dortmund Bundesliga 2019 Highlights", tournament:"Bundesliga", year:2019, homeTeam:"Bayern Munich", awayTeam:"Dortmund", stage:"Regular Season" },
  // Europa League 2016 Liverpool vs Sevilla
  { id:"qW3yY5K5kYg", ytTitle:"Liverpool vs Sevilla Europa League 2016 Final Highlights", tournament:"Europa League", year:2016, homeTeam:"Liverpool", awayTeam:"Sevilla", stage:"Final" },
];

async function main(){
  console.log("=== POST 2 DIVERSE NOT IN POSTED SET ===");
  const posted=loadPosted();
  console.log(`posted size ${posted.size}`);
  const filtered=allCandidates.filter(c=> !isPostedCandidate(c, posted));
  console.log(`filtered ${filtered.length} not posted:`, filtered.map(c=>`${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam}`));
  // we need accurate yt IDs via search fallback if id invalid
  for(const c of filtered){
    if(!c.id || c.id.length<6){
      try{
        const q=`${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} highlights`;
        const id=execSync(`yt-dlp "ytsearch1:${q}" --get-id --no-warnings 2>/dev/null | head -n1`,{encoding:"utf8",timeout:15000}).trim();
        if(id && /^[A-Za-z0-9_-]{6,}$/.test(id)){ console.log(`search fallback for ${q} => ${id}`); c.id=id; }
      }catch{}
    }
  }
  // validate yt ids via dump-json duration check and search single
  const picks=[];
  for(const c of filtered){
    // verify id exists via yt-dlp title fetch
    try{
      const title=execSync(`yt-dlp "https://www.youtube.com/watch?v=${c.id}" --get-title --no-warnings 2>/dev/null | head -n1`,{encoding:"utf8",timeout:15000}).trim();
      if(title && title.length>5){ c.ytTitle=title; console.log(`verified ${c.id} title: ${title.slice(0,80)}`); picks.push(c); }
      else {
        console.log(`id ${c.id} no title, searching...`);
        const q=`${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} highlights`;
        const alt=execSync(`yt-dlp "ytsearch1:${q}" --get-id --get-title --no-warnings 2>/dev/null | head -n 10`,{encoding:"utf8",timeout:20000}).trim().split("\n");
        if(alt.length>=2){ c.id=alt[1]; c.ytTitle=alt[0]; picks.push(c); console.log(` fallback ${c.id} ${c.ytTitle}`); }
      }
    }catch(e){ console.log(`verify fail ${c.id}: ${e.message.slice(0,100)}`); }
    if(picks.length>=2) break;
  }
  console.log(`\nFinal picks for posting:`, picks.slice(0,2).map(p=>p.id+" "+p.tournament+" "+p.homeTeam+" vs "+p.awayTeam));

  const profilePic=ensureProfilePic();
  const results=[];
  for(let i=0;i<Math.min(2,picks.length);i++){
    const c=picks[i];
    console.log(`\n--- [${i}] ${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} id=${c.id} ---`);
    const raw=`/tmp/post2_raw_${i}_${c.id}.mp4`;
    const trimmed=`/tmp/post2_trim_${i}.mp4`;
    const watermarked=`/tmp/post2_wm_${i}.mp4`;
    if(!fs.existsSync(raw) || fs.statSync(raw).size<10000){
      try{ downloadYt(c.id, raw); }catch(e){ console.log("download fail", e.message.slice(0,300)); continue; }
    }
    if(!fs.existsSync(raw)){ console.log("no raw"); continue; }
    let dur=getDuration(raw);
    console.log(` raw dur ${dur?.toFixed(1)}s`);
    if(!dur || dur<10){ console.log("bad dur"); continue; }
    let srcForWm=raw;
    if(dur>210){
      console.log(` trimming ${dur.toFixed(1)} -> 150s`);
      trimToRange(raw, trimmed, 150);
      srcForWm=trimmed;
      dur=getDuration(srcForWm);
      console.log(` trimmed dur ${dur?.toFixed(1)}s`);
    }
    if(dur<90 || dur>210){ console.log(` still out of range ${dur}, skip`); continue; }
    // cartoon check
    if(/cartoon|animation|animated|442oons|pes|efootball|simulation|simulated|lego|minecraft/i.test(c.ytTitle)){ console.log(" cartoon skip"); continue; }
    let parsed = parseHighlightFromTitle(c.ytTitle, {fallbackYear:c.year, fallbackTournament:c.tournament});
    parsed.homeTeam=c.homeTeam; parsed.awayTeam=c.awayTeam; parsed.tournament=c.tournament; parsed.year=c.year; parsed.stage=c.stage;
    console.log(` parsed ${parsed.tournament} ${parsed.year} ${parsed.homeTeam} vs ${parsed.awayTeam}`);
    const highlight={ id:`post2-${c.tournament.toLowerCase().replace(/\s+/g,"-")}-${c.year}-${c.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${c.awayTeam.toLowerCase().replace(/\s+/g,"-")}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${parsed.year}-07-01`, stage:parsed.stage, ytTitle:c.ytTitle, candidateTitle:c.ytTitle, videoUrl:`https://www.youtube.com/watch?v=${c.id}`, thumbnail:`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`, source:"yt-dlp-post2", ytId:c.id };
    const content=formatPost(highlight);
    const watermarkTexts={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage };
    const triple=validateTripleMatch(parsed, c.ytTitle, content, watermarkTexts);
    console.log(` triple ${triple.ok? "OK": "FAIL "+triple.reason}`);
    if(!triple.ok) continue;
    let logoPath; try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log("logo fail",e.message); continue; }
    console.log(` logo ${path.basename(logoPath)}`);
    try{
      applyDynamicWatermark(srcForWm, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:watermarked, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false });
    }catch(e){ console.log("watermark fail", e.message.slice(0,500)); continue; }
    const wmDur=getDuration(watermarked);
    console.log(` watermarked dur ${wmDur?.toFixed(1)}s`);
    if(!wmDur || wmDur<90 || wmDur>210){ console.log(" wm dur out of range"); continue; }
    const pubUrl=await presignUpload(watermarked);
    console.log(` uploaded ${pubUrl}`);
    const postRes=await createReel(content, pubUrl);
    const postId=postRes.post?._id || postRes._id || postRes.id || "";
    console.log(` posted ${postId}`);
    await new Promise(r=>setTimeout(r,3000));
    let verified=false;
    try{
      const v=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
      const vj=JSON.parse(await v.text()); const post=vj.post||vj;
      const hasVideo=(post.mediaItems||[]).length===1 && post.mediaItems[0].type==="video";
      const status=post.platforms?.[0]?.status;
      verified=hasVideo && status==="published";
      console.log(` verify hasVideo=${hasVideo} status=${status} => ${verified}`);
    }catch(e){ console.log(" verify err", e.message.slice(0,200)); }
    results.push({i, id:c.id, tournament:c.tournament, year:c.year, homeTeam:c.homeTeam, awayTeam:c.awayTeam, duration:Math.round(wmDur), publicUrl:pubUrl, postId, verified, content});
    // persist to posted set if verified
    if(verified){
      posted.add(highlight.id);
      const ht=normalizeTeam(highlight.homeTeam), at=normalizeTeam(highlight.awayTeam);
      const tNorm=highlight.tournament.toLowerCase().replace(/\s+/g,"-");
      for(const k of [`historic-${tNorm}-${highlight.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${highlight.year}_${tNorm}`, `${ht}_vs_${at}_${highlight.year}`]) posted.add(k);
      savePosted(posted);
    }
    await new Promise(r=>setTimeout(r,1000));
    if(results.filter(r=>r.verified).length>=2) break;
  }
  fs.writeFileSync("/tmp/post2_results.json", JSON.stringify(results,null,2));
  console.log("\n=== DONE ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{ console.error(e); process.exit(1); });
