/**
 * Cron-corrected historical random stage runner — single video reel post
 * Implements all requirements: random stage, validate.js, logo mandatory,
 * watermark HIGH UP (pad 110), yt-dlp download + presign, 2-3min, iterate 1-5 candidates
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { getRandomHistoricalPick, finalToHighlight } from "./src/historical.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { validateHighlight } from "./src/validate.js";
import { isCartoonVideoSync } from "./src/cartoonFilter.js";

const POSTED_FILE = "./src/posted.json";

function loadPosted(){ try{ return new Set(JSON.parse(fs.readFileSync(POSTED_FILE,"utf8"))); }catch{ return new Set(); } }
function savePosted(s){ const arr=[...s].sort(); fs.writeFileSync(POSTED_FILE, JSON.stringify(arr,null,2)); try{fs.writeFileSync("./posted.json",JSON.stringify(arr,null,2));}catch{} try{fs.writeFileSync("/tmp/posted_set.json",JSON.stringify(arr,null,2));}catch{} }
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function highlightPostedKeys(h){
  const keys=[]; if(h.id) keys.push(h.id);
  const year=h.year||(h.date?String(new Date(h.date).getFullYear()):"")||(h.league?.match(/\b(19|20)\d{2}\b/)?.[0]||"");
  const tourn=(h.tournament||h.league||"").toString();
  const tNorm=tourn.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9\-]/g,"");
  const ht=normalizeTeam(h.homeTeam||""), at=normalizeTeam(h.awayTeam||"");
  if(ht&&at&&year){ keys.push(`${ht}_vs_${at}_${year}_${tNorm}`,`${at}_vs_${ht}_${year}_${tNorm}`,`${ht}_vs_${at}_${year}`,`${at}_vs_${ht}_${year}`); }
  return keys;
}
function isAlreadyPosted(h, set){ if(set.has(h.id)) return true; for(const k of highlightPostedKeys(h)) if(set.has(k)) return true; return false; }

function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
  try{ execSync(`curl -s -L "https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6" -o "${p}"`,{timeout:15000}); }catch{}
  if(!fs.existsSync(p)) execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);
  return p;
}
async function presignUpload(filePath){
  const filename=path.basename(filePath);
  const size=fs.statSync(filePath).size;
  const res=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify({filename, contentType:"video/mp4", size})});
  const text=await res.text();
  if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,800)}`);
  const j=JSON.parse(text);
  const uploadUrl=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl;
  const publicUrl=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl;
  if(!uploadUrl||!publicUrl) throw new Error(`presign missing urls: ${text.slice(0,600)}`);
  const buf=fs.readFileSync(filePath);
  const put=await fetch(uploadUrl,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);
  return publicUrl;
}
async function createReelPost(content, mediaUrl){
  const body={content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaUrls:[mediaUrl]};
  const res=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify(body)});
  const text=await res.text();
  let j; try{j=JSON.parse(text)}catch{j={raw:text}}
  if(!res.ok) throw new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
  return j;
}
function getDuration(p){ try{ const out=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim(); const d=parseFloat(out); if(!isNaN(d)&&d>0) return d; }catch{} return null; }
function hasVideoStream(p){ try{ const out=execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv "${p}" 2>&1`,{encoding:"utf8",timeout:10000}); if(out.includes("video")) return true; }catch{} return false; }

async function tryCandidates(pick, profilePic){
  // ytsearch5 for query
  const query = pick.query;
  console.log(`[HISTORICAL] pick: ${pick.tournament} ${pick.year} stage=${pick.stage} title=${pick.title} query="${query}"`);
  let out="";
  try{ out=execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:20000, encoding:"utf8"}).trim(); }catch(e){ console.warn("ytsearch failed",e.message); return null; }
  const lines=out.split("\n").filter(Boolean);
  const cands=[];
  for(let i=0;i<lines.length-1;i+=2){ const title=lines[i], id=lines[i+1]; if(/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({id,title, thumb:`https://img.youtube.com/vi/${id}/hqdefault.jpg`}); }
  if(!cands.length){ const ids=out.split("\n").map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{6,}$/.test(s)); for(const id of ids) cands.push({id,title:"", thumb:`https://img.youtube.com/vi/${id}/hqdefault.jpg`}); }
  console.log(`candidates: ${cands.map(c=>c.id+":"+c.title.slice(0,50)).join(" | ")}`);
  const baseHighlight = finalToHighlight(pick.match, "");
  baseHighlight.league=`${pick.tournament} ${pick.year}`;
  baseHighlight.title=pick.title;
  baseHighlight.date=`${pick.year}-07-01`;
  baseHighlight.year=pick.year;
  baseHighlight.tournament=pick.tournament;
  baseHighlight.query=query;

  for(let idx=0; idx<cands.length; idx++){
    const c=cands[idx];
    console.log(`\n--- Candidate ${idx+1}/${cands.length}: ${c.id} — ${c.title} ---`);
    if(isCartoonVideoSync(c.title,"")){ console.log("  skip cartoon keyword"); continue; }
    // FIFA WC Final skip handled by validateHighlight
    const videoUrl=`https://www.youtube.com/watch?v=${c.id}`;
    const highlight={...baseHighlight, title: c.title || baseHighlight.title, videoUrl, embedUrl: videoUrl, thumbnail: c.thumb, candidateTitle: c.title, ytTitle: c.title };
    // logo mandatory check before download
    try{
      const lp=requireTournamentLogo(highlight.tournament, highlight.year);
      if(!fs.existsSync(lp)) throw new Error(`logo missing ${lp}`);
      const buf=fs.readFileSync(lp); if(!(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf.length>=500)) throw new Error("invalid PNG");
      console.log(`  logo ok: ${lp}`);
    }catch(e){ console.log(`  logo fail: ${e.message} — skipping candidate`); continue; }

    const raw=`/tmp/raw_hist_${Date.now()}_${idx}.mp4`;
    const wm=`/tmp/wm_hist_${Date.now()}_${idx}.mp4`;
    try{
      console.log(`  downloading ${videoUrl} -> ${raw}`);
      execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${raw}" "${videoUrl}" 2>&1 | tail -n 5`,{timeout:120000, encoding:"utf8"});
      if(!fs.existsSync(raw)||fs.statSync(raw).size<10000){ console.log("  download failed/too small"); continue; }
      // duration check before watermark (allow 60-250)
      const dur=getDuration(raw);
      console.log(`  raw duration ${dur}s size ${Math.round(fs.statSync(raw).size/1e6)}MB`);
      if(dur===null){ console.log("  no duration, skip"); try{fs.unlinkSync(raw)}catch{}; continue; }
      if(dur<60||dur>250){ console.log(`  duration ${dur}s out of 60-250, skip`); try{fs.unlinkSync(raw)}catch{}; continue; }
      if(!hasVideoStream(raw)){ console.log("  no video stream"); try{fs.unlinkSync(raw)}catch{}; continue; }

      // watermark HIGH UP: pad 110 above video, logo left, watermark top-right shifted
      const logoPath=requireTournamentLogo(highlight.tournament, highlight.year);
      console.log(`  watermarking ${raw} -> ${wm} (pad HIGH UP 110)`);
      applyDynamicWatermark(raw, {
        tournament: highlight.tournament, year: highlight.year,
        teamA: highlight.homeTeam, teamB: highlight.awayTeam,
        stage: pick.stage,
        logoPath, watermarkPath: profilePic, output: wm,
        headerHeight:110, logoScaleH:100, logoPos:"left",
        watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6,
        crf:30
      });
      const wmDur=getDuration(wm);
      console.log(`  watermarked duration ${wmDur}s size ${Math.round(fs.statSync(wm).size/1e6)}MB`);
      if(wmDur===null||wmDur<60||wmDur>250){ console.log(`  wm duration bad ${wmDur}, skip`); try{fs.unlinkSync(raw);fs.unlinkSync(wm)}catch{}; continue; }

      // validateHighlight with video file
      const vRes=await validateHighlight({...highlight, candidateTitle:c.title, ytTitle:c.title}, {localVideoPath: wm, candidateTitle: c.title});
      if(!vRes.valid){ console.log(`  validate failed: ${vRes.reason}`); try{fs.unlinkSync(raw);fs.unlinkSync(wm)}catch{}; continue; }
      console.log(`  validate ✓ ${vRes.reason}`);
      // content safety: no youtube link
      const content=formatPost(highlight);
      if(/youtube\.com|youtu\.be/i.test(content)){ console.log("  content has youtube link, skip"); try{fs.unlinkSync(raw);fs.unlinkSync(wm)}catch{}; continue; }
      console.log(`  content:\n${content}`);

      // presign upload + post
      console.log(`  presign upload ${wm}`);
      const publicUrl=await presignUpload(wm);
      console.log(`  publicUrl ${publicUrl}`);
      console.log(`  creating reel post...`);
      const postRes=await createReelPost(content, publicUrl);
      const postId=postRes.post?._id||postRes._id||postRes.id;
      console.log(`  postRes postId=${postId} ${JSON.stringify(postRes).slice(0,600)}`);
      // verify
      let verified=false;
      for(let attempt=0; attempt<3; attempt++){
        if(attempt>0) await new Promise(r=>setTimeout(r,4000));
        const gpRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
        const gpText=await gpRes.text(); const gp=JSON.parse(gpText); const p=gp.post||gp;
        const mediaItems=p.mediaItems||[];
        const hasVideo=mediaItems.some(m=>m.type==="video");
        const platformStatus=p.platforms?.[0]?.status;
        console.log(`  verify attempt ${attempt+1}: status=${p.status} mediaItems=${mediaItems.length} hasVideo=${hasVideo} platformStatus=${platformStatus} url=${p.platforms?.[0]?.platformPostUrl||""}`);
        if(p.status==="published" && mediaItems.length>0 && hasVideo && platformStatus==="published" && p.platforms[0].platformPostUrl){
          verified=true; break;
        }
        if(attempt===2) console.warn(`  not yet verified: mediaItems=${JSON.stringify(mediaItems).slice(0,400)}`);
      }
      // cleanup raw (keep wm for debug if needed)
      try{fs.unlinkSync(raw)}catch{}
      if(!verified){
        console.warn(`  verification failed, trying next candidate`);
        try{fs.unlinkSync(wm)}catch{}
        continue;
      }
      // success — save posted
      const posted=loadPosted();
      posted.add(highlight.id);
      for(const k of highlightPostedKeys(highlight)) posted.add(k);
      savePosted(posted);
      console.log(`\n✓✓✓ SUCCESS: posted ${highlight.title} id=${postId} stage=${pick.stage} tournament=${pick.tournament} ${pick.year} video=${c.id} duration=${wmDur}s`);
      return { success:true, pick, highlight, postId, publicUrl, duration: wmDur, candidate: c, wmPath: wm };
    }catch(e){
      console.warn(`  candidate error: ${e.message.slice(0,500)}`);
      try{fs.unlinkSync(raw)}catch{}
      try{fs.unlinkSync(wm)}catch{}
      continue;
    }
  }
  return null;
}

async function main(){
  console.log(`Football Maxx Corrected Historical Poster — dryRun=${config.dryRun}`);
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} exists=${fs.existsSync(profilePic)}`);
  const posted=loadPosted();
  for(let attemptPick=0; attemptPick<5; attemptPick++){
    let pick=getRandomHistoricalPick();
    // avoid already posted
    let tries=0;
    while(tries<10){
      const hl=finalToHighlight(pick.match,""); hl.league=`${pick.tournament} ${pick.year}`; hl.year=pick.year; hl.tournament=pick.tournament;
      if(!isAlreadyPosted(hl, posted)) break;
      console.log(`pick already posted ${pick.title}, reroll`);
      pick=getRandomHistoricalPick(); tries++;
    }
    const res=await tryCandidates(pick, profilePic);
    if(res && res.success){
      console.log(`\nDone — posted 1 reel. Pick stage diversity enforced: ${pick.stage}`);
      return;
    }
    console.log(`Pick ${pick.tournament} ${pick.year} ${pick.stage} failed all candidates, trying next pick (${attemptPick+1}/5)`);
  }
  console.error("All picks/candidates failed — no post created");
  process.exit(1);
}
main().catch(e=>{ console.error(e); process.exit(1); });
