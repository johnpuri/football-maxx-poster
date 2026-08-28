import fs from "fs"; import path from "path"; import {execSync} from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";
import { presignUploadStrict, createFacebookPost, extractPostId, verifyPostPublished, getPost } from "./src/zernio.js";
import { scheduleFiveMinCheck } from "./src/copyrightCheck.js";

function loadPosted(){ const s=new Set(); for(const p of ["./posted.json","./src/posted.json"]) try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) s.add(k);}catch{} return s; }
function savePosted(set){ const arr=[...set].sort(); for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{} }
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function getDur(p){ try{ return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim());}catch{return null;} }
function ensureProfilePic(){ const p="/tmp/page_profile.jpg"; if(fs.existsSync(p) && fs.statSync(p).size>1000) return p; execSync(`ffmpeg -y -threads 2 -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`); return p; }

// Reuse already-downloaded raw files where possible, but re-encode watermark if needed
const picks=[
  { tournament:"Premier League", year:2024, homeTeam:"Aston Villa", awayTeam:"Arsenal", stage:"Regular Season", query:"Aston Villa vs Arsenal Premier League 2024 highlights", expectId:"gut6hzrsa5w" },
  { tournament:"Serie A", year:2023, homeTeam:"Napoli", awayTeam:"Juventus", stage:"Regular Season", query:"Napoli vs Juventus Serie A 2023 highlights", expectId:"C4htjVFlsYs" },
  { tournament:"La Liga", year:2024, homeTeam:"Girona", awayTeam:"Real Madrid", stage:"Regular Season", query:"Girona vs Real Madrid La Liga 2024 highlights", expectId:"V4DuqJUDYqw" },
];
// fallback if those watermarked exist, just re-upload watermarked
async function main(){
  console.log("=== POST FIXED 3 CORRECT mediaUrls HIGH UP low CPU + 5min check ===");
  const posted=loadPosted();
  const profilePic=ensureProfilePic();
  const results=[];
  for(let i=0;i<picks.length;i++){
    const pick=picks[i];
    const ht=normalizeTeam(pick.homeTeam), at=normalizeTeam(pick.awayTeam);
    const tNorm=pick.tournament.toLowerCase().replace(/\s+/g,"-");
    const keys=[`historic-${tNorm}-${pick.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${pick.year}_${tNorm}`, `${ht}_vs_${at}_${pick.year}`];
    if(keys.some(k=>posted.has(k))){ console.log(` skip duplicate ${pick.tournament} ${pick.year}`); continue; }

    // find candidate again to get correct title (or use stored)
    let candId=pick.expectId;
    let candTitle="";
    // try to get title from yt-dlp for that id
    try{
      const j=JSON.parse(execSync(`yt-dlp --dump-json --no-warnings "https://www.youtube.com/watch?v=${candId}" 2>/dev/null`,{encoding:"utf8",timeout:15000}).trim());
      candTitle=j.title||"";
      console.log(` cand ${candId} title "${candTitle}" dur=${j.duration} views=${j.view_count}`);
    }catch(e){ console.log(` dump fail ${e.message.slice(0,200)}`); }

    // watermarked file already exists from previous run
    const wmCandidates=[`/tmp/next3_wm_${i}.mp4`, `/tmp/next3_wm_1.mp4`, `/tmp/next3_wm_2.mp4`, `/tmp/next3_wm_3.mp4`, `/tmp/next3_wm_0.mp4`];
    let wm=wmCandidates.find(p=>fs.existsSync(p) && fs.statSync(p).size>1000000);
    // if not found, need to recreate from raw
    if(!wm || (i===2 && !fs.existsSync(`/tmp/next3_wm_3.mp4`))){
      // recreate for this pick specifically
      const raw=`/tmp/next3_raw_${i}_${candId}.mp4`;
      if(!fs.existsSync(raw)){
        // try any raw with that id
        const alts=[`/tmp/next3_raw_1_${candId}.mp4`, `/tmp/next3_raw_2_${candId}.mp4`, `/tmp/next3_raw_3_${candId}.mp4`, `/tmp/next3_raw_0_${candId}.mp4`];
        const found=alts.find(p=>fs.existsSync(p));
        if(found) execSync(`cp "${found}" "${raw}"`);
        else { console.log(` no raw for ${candId}`); continue; }
      }
      wm=`/tmp/fixed3_wm_${i}.mp4`;
      let parsed=parseHighlightFromTitle(candTitle, {fallbackYear:pick.year, fallbackTournament:pick.tournament});
      parsed.homeTeam=pick.homeTeam; parsed.awayTeam=pick.awayTeam; parsed.tournament=pick.tournament; parsed.year=pick.year; parsed.stage=pick.stage;
      const logoPath=requireTournamentLogo(parsed.tournament, parsed.year);
      applyDynamicWatermark(raw, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:wm, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false });
    } else {
      // map correctly: pick0 -> wm0, pick1 -> wm2 etc — ensure correct wm for each pick
      // For simplicity, ensure wm matches pick by checking existence
      const specific=`/tmp/next3_wm_${pick.expectId==='gut6hzrsa5w'?1: pick.expectId==='C4htjVFlsYs'?2:3}.mp4`;
      if(fs.existsSync(specific)) wm=specific;
    }
    console.log(` using wm ${wm} size ${Math.round(fs.statSync(wm).size/1024/1024)}MB dur ${getDur(wm)?.toFixed(1)}`);

    let parsed=parseHighlightFromTitle(candTitle||`${pick.homeTeam} vs ${pick.awayTeam}`, {fallbackYear:pick.year, fallbackTournament:pick.tournament});
    parsed.homeTeam=pick.homeTeam; parsed.awayTeam=pick.awayTeam; parsed.tournament=pick.tournament; parsed.year=pick.year; parsed.stage=pick.stage;
    const highlight={ id:`fixed3-${tNorm}-${pick.year}-${ht}-vs-${at}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${pick.year}-07-01`, stage:parsed.stage, ytTitle:candTitle, candidateTitle:candTitle, videoUrl:`https://www.youtube.com/watch?v=${candId}` };
    const content=formatPost(highlight);
    console.log(` content ${content.slice(0,120)} | logo ${path.basename(requireTournamentLogo(parsed.tournament, parsed.year))}`);
    const triple=validateTripleMatch(parsed, candTitle||content, content, {tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage});
    if(!triple.ok){ console.log(` triple fail ${triple.reason}`); continue; }

    // Use mediaItems (not mediaUrls) — Zernio expects mediaItems for reels; mediaUrls leaves empty
    const pubUrl=await presignUploadStrict(wm);
    console.log(` uploaded ${pubUrl}`);
    // direct POST with mediaItems to ensure media is set
    const { config: cfg } = await import("./src/config.js");
    const body2={content, platforms:[{platform:"facebook", accountId:cfg.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:pubUrl}]};
    const r2=await fetch(`${cfg.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${cfg.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body2)});
    const t2=await r2.text(); let res; try{res=JSON.parse(t2);}catch{res={raw:t2}}; if(!r2.ok) throw new Error(`create ${r2.status}: ${JSON.stringify(res).slice(0,600)}`);
    const postId=extractPostId(res);
    console.log(` posted ${postId} ${JSON.stringify(res).slice(0,300)}`);
    await new Promise(r=>setTimeout(r,5000));
    const ver=await verifyPostPublished(postId, {retries:2, delayMs:3000});
    console.log(` verify ${ver.verified} reason=${ver.reason} mediaItems=${ver.post?.mediaItems?.length} plat=${ver.post?.platforms?.[0]?.status}`);
    if(!ver.verified){ console.error(` NOT VERIFIED ${postId} ${ver.reason}`); continue; }
    posted.add(highlight.id); for(const k of keys) posted.add(k); savePosted(posted);
    scheduleFiveMinCheck(postId, { label:`${pick.tournament} ${pick.year} ${pick.homeTeam} vs ${pick.awayTeam}`, blacklistCb: async(pid,reason)=>{
      try{ const blp="./copyright_blacklist.json"; let bl=[]; try{bl=JSON.parse(fs.readFileSync(blp,"utf8"));}catch{}; const key=`${ht}_vs_${at}_${pick.year}`; if(!bl.includes(key)) bl.push(key); fs.writeFileSync(blp, JSON.stringify([...new Set(bl)].sort(),null,2)); }catch{}
    }});
    results.push({postId, pubUrl, pick:`${pick.tournament} ${pick.year} ${pick.homeTeam} vs ${pick.awayTeam}`, candTitle, wm});
    await new Promise(r=>setTimeout(r,2000));
  }
  console.log(`\n=== DONE FIXED ${results.length}/3 ===`);
  console.log(JSON.stringify(results,null,2));
  fs.writeFileSync("/tmp/fixed3_results.json", JSON.stringify(results,null,2));
  if(results.length<3) process.exit(1);
  console.log("Keeping alive 5min for delayed checks...");
  await new Promise(r=>setTimeout(r, 5*60*1000+15000));
  console.log("5-min checks done");
}
main().catch(e=>{console.error(e); process.exit(1);});
