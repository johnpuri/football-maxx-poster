import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { getDiverseBatch } from "./src/historical.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { isCartoonVideoSync, isCartoonVideo } from "./src/cartoonFilter.js";
import { validateHighlight, isFifaHighRisk } from "./src/validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";

function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
  try{
    const url="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";
    execSync(`curl -s -L "${url}" -o "${p}"`,{timeout:15000});
    if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
  }catch{}
  try{ execSync(`/usr/bin/ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);}catch{}
  return p;
}
async function presignUpload(filePath){
  const filename=path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const body = { filename, contentType:"video/mp4", size };
  const res=await fetch(`${config.zernioBaseUrl}/media`,{ method:"POST", headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify(body)});
  const text=await res.text();
  if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,800)}`);
  const j=JSON.parse(text);
  const uploadUrl=j.uploadUrl || j.url || j.presignedUrl || j.data?.uploadUrl;
  const publicUrl=j.publicUrl || j.publicURL || j.fileUrl || j.url || j.data?.publicUrl || j.data?.url;
  if(!uploadUrl) throw new Error(`presign missing uploadUrl: ${text.slice(0,800)}`);
  const finalPublicUrl = publicUrl || uploadUrl.split('?')[0];
  const buf=fs.readFileSync(filePath);
  const put=await fetch(uploadUrl,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`upload PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);
  return finalPublicUrl;
}
async function createReelPost(content, mediaUrl){
  const payloads = [
    { content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}] },
    { content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaUrls:[mediaUrl] },
  ];
  let lastErr;
  for(const body of payloads){
    const res=await fetch(`${config.zernioBaseUrl}/posts`,{ method:"POST", headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify(body)});
    const text=await res.text();
    let j; try{j=JSON.parse(text);}catch{j={raw:text}}
    if(res.ok) return j;
    lastErr = new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
    if(res.status===400) continue;
    throw lastErr;
  }
  throw lastErr;
}
function getDuration(p){
  try{ const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`, {encoding:"utf8", timeout:10000}).trim(); const d=parseFloat(out); if(!isNaN(d)) return d; }catch{}
  return null;
}
function downloadWithInfo(url, out){
  let info=null;
  try{ const j = execSync(`yt-dlp --dump-json --no-playlist "${url}" 2>/dev/null | head -n 1`, {encoding:"utf8", timeout:15000}).trim(); if(j) info=JSON.parse(j); }catch{}
  const cmd=`yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`;
  console.log(cmd);
  try{ execSync(cmd,{stdio:"inherit", timeout:180000}); }catch(e){ if(!fs.existsSync(out)) throw e; }
  if(!fs.existsSync(out)) throw new Error(`download failed ${out}`);
  return info;
}
function tryYtSearch5(query){
  try{
    const out=execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:25000, encoding:"utf8"}).trim();
    const lines=out.split("\n").filter(Boolean);
    const cands=[];
    for(let i=0;i<lines.length-1;i+=2){ const title=lines[i]; const id=lines[i+1]; if(/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({id,title, thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});}
    if(!cands.length){ const ids=out.split("\n").map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{6,}$/.test(s)); for(const id of ids) cands.push({id,title:"", thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});}
    return cands;
  }catch{ return []; }
}

async function main(){
  console.log("=== VERIFY 8 reels — single source of truth from ytTitle, HIGH UP bar, logo mandatory ===");
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} ${fs.existsSync(profilePic)?fs.statSync(profilePic).size:0}`);
  const results=[];
  let attempts=0;
  const seenPosts=new Set();
  const seenTeams=new Set();
  while(results.length<8 && attempts<40){
    attempts++;
    const batch=getDiverseBatch(6);
    const pick = batch[Math.floor(Math.random()*batch.length)];
    if(/world cup/i.test(pick.tournament) && /final/i.test(pick.title)){ console.log(`skip WC final pick ${pick.title}`); continue; }
    const pickKey=`${pick.tournament}-${pick.year}-${pick.match.homeTeam}-${pick.match.awayTeam}`;
    // allow reuse but dedup teams already posted
    const cands = tryYtSearch5(pick.query);
    console.log(`\n--- Attempt ${attempts} pick ${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam} [${cands.length} cands] query=${pick.query} ---`);
    if(!cands.length){ console.log("  no cands"); continue; }
    let found=false;
    for(let ci=0; ci<cands.length; ci++){
      const c=cands[ci];
      console.log(`  Candidate ${ci+1}: ${c.id} — ${c.title.slice(0,90)}`);
      if(isCartoonVideoSync(c.title,"")){ console.log("    skip cartoon"); continue; }
      if(await isCartoonVideo(c.title,"",c.thumbnail)){ console.log("    skip cartoon vision"); continue; }
      if(isFifaHighRisk({title:c.title, description:c.title, league:`${pick.tournament} ${pick.year}`, uploader:""}).risk){ console.log("    skip FIFA risk"); continue; }
      const parsed = parseHighlightFromTitle(c.title, { fallbackYear: pick.year, fallbackTournament: pick.tournament });
      if(!parsed.homeTeam || !parsed.awayTeam){ console.log(`    skip parse fail home=${parsed.homeTeam} away=${parsed.awayTeam}`); continue; }
      const teamKey=`${parsed.homeTeam.toLowerCase()} vs ${parsed.awayTeam.toLowerCase()} ${parsed.tournament} ${parsed.year}`;
      if(seenTeams.has(teamKey)){ console.log("    skip duplicate teams already posted"); continue; }
      const highlight = {
        id:`verify8-${c.id}`, title: `${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,
        league: `${parsed.tournament} ${parsed.year}`, homeTeam: parsed.homeTeam, awayTeam: parsed.awayTeam,
        tournament: parsed.tournament, year: parsed.year, date: `${parsed.year}-07-01`, stage: parsed.stage,
        ytTitle: c.title, candidateTitle: c.title, videoUrl:`https://www.youtube.com/watch?v=${c.id}`, embedUrl:`https://www.youtube.com/watch?v=${c.id}`,
        thumbnail:c.thumbnail, source:"verify8", ytId:c.id
      };
      const content = formatPost(highlight);
      if(/youtube\.com|youtu\.be/i.test(content)){ console.log("    skip yt link"); continue; }
      const watermarkTexts = { tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage: parsed.stage };
      const triple = validateTripleMatch(parsed, c.title, content, watermarkTexts);
      if(!triple.ok){ console.log(`    skip triple ${triple.reason}`); continue; }
      let logoPath;
      try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log(`    skip logo ${e.message}`); continue; }
      if(!fs.existsSync(logoPath)){ console.log(`    skip logo missing`); continue; }
      const buf=fs.readFileSync(logoPath);
      if(!(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47 && buf.length>=500)){ console.log("    skip invalid PNG"); continue; }
      const raw=`/tmp/raw_verify8_${results.length}_${ci}.mp4`;
      try{ downloadWithInfo(highlight.videoUrl, raw);}catch(e){ console.log(`    download fail ${e.message.slice(0,120)}`); continue; }
      const dur=getDuration(raw);
      console.log(`    duration ${dur?.toFixed(1)}s`);
      if(dur===null || dur<60 || dur>250){ console.log(`    skip duration`); try{fs.unlinkSync(raw);}catch{}; continue; }
      if(dur<120 || dur>180) console.log(`    note: duration outside ideal 2-3min but allowed`);
      const v=await validateHighlight({...highlight, title:c.title, candidateTitle:c.title, ytTitle:c.title}, {localVideoPath: raw, skipVision:true, candidateTitle:c.title});
      if(!v.valid){ console.log(`    validate fail ${v.reason}`); try{fs.unlinkSync(raw);}catch{}; continue; }
      const watermarked=`/tmp/wm_verify8_${results.length}.mp4`;
      console.log(`    APPLY WATERMARK HIGH UP 110 logo ${path.basename(logoPath)} ${parsed.homeTeam} vs ${parsed.awayTeam}`);
      try{
        applyDynamicWatermark(raw, {
          tournament: parsed.tournament, year: parsed.year, teamA: parsed.homeTeam, teamB: parsed.awayTeam, stage: parsed.stage,
          logoPath, watermarkPath: profilePic, output: watermarked, headerHeight:110, logoScaleH:100, logoPos:"left",
          watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false,
        });
      }catch(e){ console.log(`    watermark fail ${e.message}`); try{fs.unlinkSync(raw);}catch{}; continue; }
      const wmDur=getDuration(watermarked);
      console.log(`    watermarked ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
      console.log(`    content first line: ${content.split("\n")[0]}`);
      console.log(`    watermarkTexts: ${JSON.stringify(watermarkTexts)} logo=${logoPath}`);
      const publicUrl=await presignUpload(watermarked);
      console.log(`    uploaded ${publicUrl}`);
      const postRes=await createReelPost(content, publicUrl);
      console.log(`    posted ${JSON.stringify(postRes).slice(0,500)}`);
      const postId=postRes.post?._id || postRes._id || postRes.id || "";
      await new Promise(r=>setTimeout(r,4000));
      // verification GET
      let verified=false, verifyInfo={};
      try{
        const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
        const vj=JSON.parse(await vRes.text()); const post=vj.post||vj;
        const mediaItems=post.mediaItems||[];
        const contentGot=post.content||"";
        const hasVideo = mediaItems.length===1 && mediaItems[0].type==="video";
        const contentOk = contentGot.toLowerCase().includes(parsed.homeTeam.toLowerCase().split(" ")[0]) && contentGot.toLowerCase().includes(parsed.awayTeam.toLowerCase().split(" ")[0]);
        const status=post.platforms?.[0]?.status;
        console.log(`    VERIFY mediaItems=${mediaItems.length} type=${mediaItems[0]?.type} status=${status} contentOk=${contentOk} hasVideo=${hasVideo}`);
        verifyInfo={mediaItems: mediaItems.length, type: mediaItems[0]?.type, status, contentOk, hasVideo, contentGot: contentGot.slice(0,120)};
        // Strict triple already validated; now confirm GET content matches watermark bar texts and ytTitle teams
        const norm=s=>s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
        const ytOk = norm(c.title).includes(norm(parsed.homeTeam)) && norm(c.title).includes(norm(parsed.awayTeam));
        const barOk = norm(watermarkTexts.matchText).includes(norm(parsed.homeTeam)) && norm(watermarkTexts.matchText).includes(norm(parsed.awayTeam));
        verified = hasVideo && contentOk && ytOk && barOk && status==="published";
        console.log(`    VERIFY ytOk=${ytOk} barOk=${barOk} verified=${verified}`);
        if(!verified){ console.log("    verify failed — but keeping record"); }
      }catch(e){ console.log("    verify err", e.message); }
      results.push({ idx: results.length+1, parsed, ytTitle:c.title, ytUrl:highlight.videoUrl, content, watermarkTexts, logo: path.basename(logoPath), logoPath, duration: Math.round(dur), wmDuration: wmDur?Math.round(wmDur):null, publicUrl, postId, verified, verifyInfo, bar:"HIGH UP pad 110px", watermark: "top-right 140px W-w-5:115" });
      seenTeams.add(teamKey);
      try{fs.unlinkSync(raw);}catch{};
      // cleanup watermarked keep? remove to save space
      // try{fs.unlinkSync(watermarked);}catch{};
      found=true;
      break;
    }
    if(!found) console.log(`  No valid candidate for ${pick.query}`);
    await new Promise(r=>setTimeout(r,1500));
  }
  fs.writeFileSync("/tmp/verify8_results.json", JSON.stringify(results,null,2));
  console.log("\n=== VERIFY 8 DONE ===");
  console.log(JSON.stringify(results,null,2));
  if(results.length<8) console.log(`WARNING only ${results.length}/8`);
  else console.log("SUCCESS 8 posts — checking verifications");
  for(const r of results){ console.log(`${r.idx}. ${r.parsed.tournament} ${r.parsed.year} ${r.parsed.homeTeam} vs ${r.parsed.awayTeam} postId=${r.postId} verified=${r.verified} dur=${r.duration}s yt=${r.ytTitle.slice(0,60)}`); }
}
main().catch(e=>{ console.error(e); process.exit(1);});
