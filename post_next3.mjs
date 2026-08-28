import fs from "fs"; import path from "path"; import {execSync} from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";
import { scheduleFiveMinCheck } from "./src/copyrightCheck.js";

function loadPosted(){ const s=new Set(); for(const p of ["./posted.json","./src/posted.json"]) try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) s.add(k);}catch{} return s; }
function savePosted(set){ const arr=[...set].sort(); for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{} }
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function getDur(p){ try{ const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim(); return parseFloat(o);}catch{ return null; } }
function ensureProfilePic(){ const p="/tmp/page_profile.jpg"; if(fs.existsSync(p) && fs.statSync(p).size>1000) return p; execSync(`ffmpeg -y -threads 2 -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`); return p; }
async function presignUpload(fp){
  const fn=path.basename(fp); const sz=fs.statSync(fp).size; if(sz<1_000_000) throw new Error(`file too small ${sz}`);
  const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify({filename:fn, contentType:"video/mp4"})});
  const t=await r.text(); if(!r.ok) throw new Error(`presign ${r.status}: ${t.slice(0,800)}`); const j=JSON.parse(t);
  const up=j.uploadUrl; const pub=j.publicUrl||j.mediaUrl||j.url; if(!up||!pub) throw new Error(`presign missing ${t.slice(0,500)}`);
  if(!pub.startsWith("https://media.zernio.com")) throw new Error(`publicUrl not https://media.zernio.com: ${pub}`);
  const buf=fs.readFileSync(fp); const put=await fetch(up,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(put.status!==200) throw new Error(`PUT ${put.status} ${await put.text().then(s=>s.slice(0,300))}`); return pub;
}
async function createReel(content, mediaUrl){
  const body={content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaUrls:[mediaUrl]};
  const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const t=await r.text(); let j; try{j=JSON.parse(t);}catch{j={raw:t}}; if(!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j).slice(0,800)}`); return j;
}
function downloadYt(id, out){ execSync(`nice -n 19 yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist -o "${out}" "https://www.youtube.com/watch?v=${id}" 2>&1 | tail -n 5`, {timeout:180000, encoding:"utf8"}); }
function trimTo150(inp,out){ execSync(`nice -n 19 ffmpeg -y -threads 2 -ss 0 -t 150 -i "${inp}" -c:v libx264 -preset fast -crf 30 -c:a aac -b:a 96k "${out}" 2>/dev/null || nice -n 19 ffmpeg -y -threads 2 -ss 0 -t 150 -i "${inp}" -c:v libx264 -preset fast -c:a aac "${out}" 2>/dev/null`, {timeout:90000}); }

// Candidate pool: diverse club regular season safe (no WC/Euro final) — NEW combos not in posted.json
const POOL = [
  { tournament:"Premier League", year:2024, homeTeam:"Aston Villa", awayTeam:"Arsenal", stage:"Regular Season", query:"Aston Villa vs Arsenal Premier League 2024 highlights" },
  { tournament:"Premier League", year:2024, homeTeam:"Chelsea", awayTeam:"Liverpool", stage:"Regular Season", query:"Chelsea vs Liverpool Premier League 2024 highlights" },
  { tournament:"La Liga", year:2024, homeTeam:"Girona", awayTeam:"Real Madrid", stage:"Regular Season", query:"Girona vs Real Madrid La Liga 2024 highlights" },
  { tournament:"Bundesliga", year:2023, homeTeam:"Bayer Leverkusen", awayTeam:"Borussia Dortmund", stage:"Regular Season", query:"Bayer Leverkusen vs Borussia Dortmund Bundesliga 2023 highlights" },
  { tournament:"Serie A", year:2023, homeTeam:"Napoli", awayTeam:"Juventus", stage:"Regular Season", query:"Napoli vs Juventus Serie A 2023 highlights" },
  { tournament:"Ligue 1", year:2023, homeTeam:"Lens", awayTeam:"PSG", stage:"Regular Season", query:"Lens vs PSG Ligue 1 2023 highlights" },
  { tournament:"Premier League", year:2024, homeTeam:"Newcastle", awayTeam:"Man City", stage:"Regular Season", query:"Newcastle vs Manchester City Premier League 2024 highlights" },
  { tournament:"La Liga", year:2022, homeTeam:"Real Madrid", awayTeam:"Sevilla", stage:"Regular Season", query:"Real Madrid vs Sevilla La Liga 2022 highlights" },
];

function isCopyrightRisk(title, tournament){
  const c=(title+" "+tournament).toLowerCase();
  if(/world cup.*final|fifa.*final|euro.*final.*\d{4}|copa.*final/i.test(c)) return true;
  if(/world cup\s+\d{4}\s+final/i.test(c)) return true;
  return false;
}

function findBestCandidate(query, maxTry=10){
  let out="";
  try{
    out=execSync(`yt-dlp "ytsearch10:${query}" --dump-json --no-warnings 2>/dev/null`, {timeout:40000, encoding:"utf8", maxBuffer:15*1024*1024}).trim();
  }catch(e){ console.log(` ytsearch fail ${e.message.slice(0,200)}`); return null; }
  const cands=[];
  for(const line of out.split("\n").filter(Boolean)){
    if(!line.trim().startsWith("{")) continue;
    try{
      const j=JSON.parse(line);
      if(!j.id) continue;
      const dur=j.duration||0;
      // native 2-3min ideal 120-210, allow 90-240, prefer 120-210
      if(dur && (dur<90 || dur>240)) continue;
      if(isCopyrightRisk(j.title||"", query)) { console.log(` skip copyright ${j.title}`); continue; }
      // avoid cartoon
      if(/cartoon|animation|pes |efootball|simulation|lego/i.test(j.title||"")) continue;
      cands.push({ id:j.id, title:j.title||"", view_count:j.view_count||0, like_count:j.like_count||0, duration:dur, uploader:j.uploader||"" });
    }catch{}
  }
  if(!cands.length) return null;
  cands.sort((a,b)=>(b.view_count||0)-(a.view_count||0) || (b.like_count||0)-(a.like_count||0));
  // filter high likes: prefer >10k views
  const filtered=cands.filter(c=>c.view_count>=10000);
  const pool=filtered.length?filtered:cands;
  // prefer 120-210
  const ideal=pool.filter(c=>c.duration>=120 && c.duration<=210);
  const best=(ideal.length?ideal:pool)[0];
  console.log(` candidates ${cands.length}, best ${best.id} "${best.title}" views=${best.view_count} likes=${best.like_count} dur=${best.duration} uploader=${best.uploader}`);
  return best;
}

async function postOne(pick, idx, posted, profilePic){
  console.log(`\n=== PICK ${idx+1}: ${pick.tournament} ${pick.year} ${pick.homeTeam} vs ${pick.awayTeam} ===`);
  const ht=normalizeTeam(pick.homeTeam), at=normalizeTeam(pick.awayTeam);
  const tNorm=pick.tournament.toLowerCase().replace(/\s+/g,"-");
  const keys=[`historic-${tNorm}-${pick.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${pick.year}_${tNorm}`, `${ht}_vs_${at}_${pick.year}`];
  if(keys.some(k=>posted.has(k))){ console.log(` SKIP duplicate ${keys[0]}`); return null; }

  const cand=findBestCandidate(pick.query);
  if(!cand){ console.log(` no candidate for ${pick.query}`); return null; }
  // double-check duration 2-3min
  if(cand.duration && (cand.duration<90 || cand.duration>240)){ console.log(` duration out of range ${cand.duration}`); return null; }

  const raw=`/tmp/next3_raw_${idx}_${cand.id}.mp4`;
  const trimmed=`/tmp/next3_trim_${idx}.mp4`;
  const wm=`/tmp/next3_wm_${idx}.mp4`;
  if(!fs.existsSync(raw) || fs.statSync(raw).size<10000){
    try{ downloadYt(cand.id, raw); }catch(e){ console.error(` download fail ${e.message.slice(0,400)}`); return null; }
  }
  let dur=getDur(raw); console.log(` raw dur ${dur?.toFixed(1)} size ${Math.round(fs.statSync(raw).size/1024/1024)}MB`);
  let src=raw;
  if(dur>210){ console.log(` trimming ${dur.toFixed(1)} ->150`); trimTo150(raw, trimmed); src=trimmed; dur=getDur(src); console.log(` trimmed dur ${dur?.toFixed(1)}`); }
  if(dur<90 || dur>240){ console.error(` out of range ${dur}`); return null; }

  let parsed=parseHighlightFromTitle(cand.title, {fallbackYear:pick.year, fallbackTournament:pick.tournament});
  parsed.homeTeam=pick.homeTeam; parsed.awayTeam=pick.awayTeam; parsed.tournament=pick.tournament; parsed.year=pick.year; parsed.stage=pick.stage;
  const highlight={ id:`next3-${tNorm}-${pick.year}-${ht}-vs-${at}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${pick.year}-07-01`, stage:parsed.stage, ytTitle:cand.title, candidateTitle:cand.title, videoUrl:`https://www.youtube.com/watch?v=${cand.id}`, ytId:cand.id };
  const content=formatPost(highlight);
  console.log(` content ${content.slice(0,100)}`);
  const triple=validateTripleMatch(parsed, cand.title, content, {tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage});
  if(!triple.ok){ console.log(` triple fail ${triple.reason}`); return null; }
  let logoPath; try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); const buf=fs.readFileSync(logoPath); if(!(buf[0]==0x89&&buf[1]==0x50&&buf[2]==0x4E&&buf[3]==0x47 && buf.length>=500)) throw new Error("bad png"); }catch(e){ console.log(` logo fail ${e.message}`); return null; }
  console.log(` logo ${path.basename(logoPath)} HIGH UP 110`);

  applyDynamicWatermark(src, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:wm, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false });
  const wmDur=getDur(wm); console.log(` wm dur ${wmDur?.toFixed(1)} size ${Math.round(fs.statSync(wm).size/1024/1024)}MB`);
  const pubUrl=await presignUpload(wm); console.log(` uploaded ${pubUrl}`);
  const res=await createReel(content, pubUrl);
  const postId=res.post?._id||res._id||res.id||res.post?.id||""; console.log(` posted ${postId}`);
  await new Promise(r=>setTimeout(r,5000));
  // immediate verify
  let verified=false; try{ const v=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}}); const vj=JSON.parse(await v.text()); const p=vj.post||vj; const hasVideo=(p.mediaItems||[]).length===1; const st=p.platforms?.[0]?.status; verified=hasVideo && st==="published" && !p.platforms?.[0]?.platformSpecificData?.deletedFromPlatform; console.log(` immediate verify hasVideo=${hasVideo} status=${st} verified=${verified}`); }catch(e){ console.log(` verify err ${e.message.slice(0,200)}`); }
  if(!verified){ console.error(` NOT VERIFIED ${postId}`); try{ await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{method:"DELETE", headers:{Authorization:`Bearer ${config.zernioApiKey}`}});}catch{} return null; }

  // save posted
  posted.add(highlight.id); for(const k of keys) posted.add(k); savePosted(posted);
  // append to blacklist if later removed? schedule 5-min check
  scheduleFiveMinCheck(postId, {
    label:`${pick.tournament} ${pick.year} ${pick.homeTeam} vs ${pick.awayTeam}`,
    blacklistCb: async (pid, reason)=>{
      // add to blacklist
      try{
        const blp="./copyright_blacklist.json"; let bl=[]; try{bl=JSON.parse(fs.readFileSync(blp,"utf8"));}catch{}; const key=`${ht}_vs_${at}_${pick.year}`; if(!bl.includes(key)) bl.push(key); fs.writeFileSync(blp, JSON.stringify([...new Set(bl)].sort(),null,2));
        // also remove from posted? keep but mark
      }catch{}
    }
  });
  // also periodic verify: if removed within 5 min, we already handle, but also ensure posted.json updated
  return { postId, pubUrl, cand, wmDur, pick };
}

async function main(){
  console.log("=== POST NEXT 3 SAFE DIVERSE low CPU HIGH UP ===");
  const posted=loadPosted(); console.log(` posted ${posted.size}`);
  const profilePic=ensureProfilePic();
  // pick 3 not duplicate from pool shuffled
  const shuffled=[...POOL].sort(()=>Math.random()-0.5);
  const picks=[];
  for(const p of shuffled){
    const ht=normalizeTeam(p.homeTeam), at=normalizeTeam(p.awayTeam), tNorm=p.tournament.toLowerCase().replace(/\s+/g,"-");
    const k=`historic-${tNorm}-${p.year}-${ht}-vs-${at}`;
    if(!posted.has(k)) picks.push(p);
    if(picks.length>=3) break;
  }
  // fallback if not enough, allow any
  if(picks.length<3) for(const p of POOL) if(!picks.includes(p) && picks.length<3) picks.push(p);
  console.log(` picks: ${picks.map(p=>`${p.tournament} ${p.year} ${p.homeTeam} vs ${p.awayTeam}`).join(" | ")}`);

  const results=[];
  for(let i=0;i<picks.length;i++){
    const r=await postOne(picks[i], i, posted, profilePic);
    if(r) results.push(r);
    else { console.log(` retry next candidate for slot ${i}`); // try next pool item
      const remaining=POOL.filter(x=>!picks.includes(x) && !results.some(rr=>rr.pick===x));
      if(remaining.length){ const alt=remaining[0]; picks.push(alt); // will be processed as extra
      }
    }
    // small gap between posts
    if(i < picks.length-1) await new Promise(r=>setTimeout(r,3000));
  }
  // If less than 3 posted, try more
  let attempts=0;
  while(results.length<3 && attempts<6){
    attempts++;
    const remaining=POOL.filter(p=>{
      const ht=normalizeTeam(p.homeTeam), at=normalizeTeam(p.awayTeam), tNorm=p.tournament.toLowerCase().replace(/\s+/g,"-");
      return ![...posted].some(k=>k.includes(ht) && k.includes(at) && k.includes(String(p.year)));
    });
    // actually just try next pool not yet tried
    const notYet=POOL.filter(p=>!picks.includes(p));
    if(!notYet.length) break;
    const extra=notYet[0]; picks.push(extra);
    const r=await postOne(extra, picks.length-1, posted, profilePic);
    if(r) results.push(r);
  }

  console.log(`\n=== DONE ${results.length}/3 posted ===`);
  console.log(JSON.stringify(results.map(r=>({postId:r.postId, pick:`${r.pick.tournament} ${r.pick.year} ${r.pick.homeTeam} vs ${r.pick.awayTeam}`, ytTitle:r.cand.title, views:r.cand.view_count, likes:r.cand.like_count, duration:r.cand.duration, wmDur:r.wmDur})),null,2));
  fs.writeFileSync("/tmp/next3_results.json", JSON.stringify(results,null,2));
  if(results.length<3) { console.error(` only ${results.length} posted`); process.exit(1); }
  console.log("Waiting 5 min for delayed checks to fire (keeping process alive)...");
  await new Promise(r=>setTimeout(r, 5*60*1000 + 10000));
  console.log("=== 5-min checks completed ===");
}
main().catch(e=>{ console.error(e); process.exit(1); });
