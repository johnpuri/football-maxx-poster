import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { getDiverseBatch, finalToHighlight } from "./src/historical.js";
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
  try{ const j = execSync(`yt-dlp --remote-components ejs:github --cookies-from-browser chrome --dump-json --no-playlist "${url}" 2>/dev/null | head -n 1`, {encoding:"utf8", timeout:15000}).trim(); if(j) info=JSON.parse(j); }catch{}
  const cmd=`yt-dlp --remote-components ejs:github --cookies-from-browser chrome --no-playlist --max-downloads 1 -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`;
  console.log(cmd);
  try{ execSync(cmd,{stdio:"inherit", timeout:180000}); }catch(e){ if(!fs.existsSync(out)) throw e; }
  if(!fs.existsSync(out)) throw new Error(`download failed ${out}`);
  return info;
}
function tryYtSearch5(query){
  try{
    const out=execSync(`yt-dlp --remote-components ejs:github --cookies-from-browser chrome "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:25000, encoding:"utf8"}).trim();
    const lines=out.split("\n").filter(Boolean);
    const cands=[];
    for(let i=0;i<lines.length-1;i+=2){ const title=lines[i]; const id=lines[i+1]; if(/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({id,title, thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});}
    if(!cands.length){ const ids=out.split("\n").map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{6,}$/.test(s)); for(const id of ids) cands.push({id,title:"", thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});}
    return cands;
  }catch{ return []; }
}

async function findValidCandidateAligned(idx){
  // diverse picks but we will iterate candidates and for each derive highlight FROM yt title (single source of truth)
  const { getDiverseBatch } = await import("./src/historical.js");
  // We'll loop picks until 5 aligned found in outer loop, but this helper handles one aligned pick search
  return null;
}

async function main(){
  console.log("=== FIXED 5 reels inc Euro 2004 — single source of truth from ytTitle ===");
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} ${fs.existsSync(profilePic)?fs.statSync(profilePic).size:0}`);

  const results=[];
  let attempts=0;
  const seenHighlights=new Set();
  // force Euro 2004 first
  const euroPicks = [{tournament:"Euro", year:2004, match:{homeTeam:"Greece", awayTeam:"Portugal"}, title:"Euro 2004 Final — Greece vs Portugal", query:"Euro 2004 Final Greece vs Portugal extended highlights", safe:true}];
  let euroDone=false;
  while(results.length<5 && attempts<50){
    attempts++;
    let pick;
    if(!euroDone){
      pick = euroPicks[0];
    } else {
      const batch=getDiverseBatch(6);
      pick = batch[Math.floor(Math.random()*batch.length)];
    }
    // Skip WC Finals entirely
    if(/world cup/i.test(pick.tournament) && /final/i.test(pick.title)){ console.log(`skip WC final pick ${pick.title}`); continue; }
    const key=`${pick.tournament}-${pick.year}-${pick.match.homeTeam}-${pick.match.awayTeam}`;
    if(seenHighlights.has(key)) continue;
    console.log(`\n--- Attempt ${attempts} pick ${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam} query=${pick.query} ---`);
    const cands = tryYtSearch5(pick.query);
    console.log(`  cands ${cands.length}`);
    let found=null;
    for(let ci=0; ci<cands.length; ci++){
      const c=cands[ci];
      console.log(`  Candidate ${ci+1}: ${c.id} — ${c.title.slice(0,90)}`);
      if(isCartoonVideoSync(c.title,"")){ console.log("    skip cartoon keyword"); continue; }
      if(await isCartoonVideo(c.title,"",c.thumbnail)){ console.log("    skip cartoon vision"); continue; }
      if(isFifaHighRisk({title:c.title, description:c.title, league:`${pick.tournament} ${pick.year}`, uploader:""}).risk){ console.log("    skip FIFA risk"); continue; }
      // SINGLE SOURCE OF TRUTH: parse ytTitle to get highlight
      const parsed = parseHighlightFromTitle(c.title, { fallbackYear: pick.year, fallbackTournament: pick.tournament });
      if(!parsed.homeTeam || !parsed.awayTeam){ console.log(`    skip parse failed home=${parsed.homeTeam} away=${parsed.awayTeam}`); continue; }
      // tournament/year fallback to parsed
      const highlight = {
        id:`fixed-${c.id}`,
        title: `${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,
        league: `${parsed.tournament} ${parsed.year}`,
        homeTeam: parsed.homeTeam,
        awayTeam: parsed.awayTeam,
        tournament: parsed.tournament,
        year: parsed.year,
        date: `${parsed.year}-07-01`,
        stage: parsed.stage,
        ytTitle: c.title,
        candidateTitle: c.title,
        videoUrl:`https://www.youtube.com/watch?v=${c.id}`,
        embedUrl:`https://www.youtube.com/watch?v=${c.id}`,
        thumbnail:c.thumbnail,
        source:"fixed-aligned",
        ytId:c.id
      };
      // Build formatter content first line
      const content = formatPost(highlight);
      if(/youtube\.com|youtu\.be/i.test(content)){ console.log("    skip yt link in content"); continue; }
      const watermarkTexts = { tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage: parsed.stage };
      const triple = validateTripleMatch(parsed, c.title, content, watermarkTexts);
      if(!triple.ok){ console.log(`    skip triple mismatch: ${triple.reason}`); continue; }
      // logo mandatory
      let logoPath;
      try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log(`    skip logo missing ${e.message}`); continue; }
      if(!fs.existsSync(logoPath)){ console.log(`    skip logo file missing ${logoPath}`); continue; }
      const buf=fs.readFileSync(logoPath);
      if(!(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47 && buf.length>=500)){ console.log("    skip invalid PNG"); continue; }
      // download and validate duration/logo/mandatory
      const raw=`/tmp/raw_fixed_${results.length}_${ci}.mp4`;
      let info=null;
      try{ info=downloadWithInfo(highlight.videoUrl, raw);}catch(e){ console.log(`    download fail ${e.message.slice(0,120)}`); continue; }
      const dur=getDuration(raw);
      console.log(`    duration ${dur?.toFixed(1)}s`);
      if(dur===null || dur<60 || dur>250){ console.log(`    skip duration ${dur} not 60-250`); try{fs.unlinkSync(raw);}catch{}; continue; }
      // validateHighlight with skipVision (already checked)
      const v=await validateHighlight({...highlight, title:c.title, candidateTitle:c.title, ytTitle:c.title}, {localVideoPath: raw, skipVision:true, candidateTitle:c.title});
      if(!v.valid){ console.log(`    validate fail ${v.reason}`); try{fs.unlinkSync(raw);}catch{}; continue; }
      // All checks passed — watermark HIGH UP bar 110, logo mandatory
      const watermarked=`/tmp/wm_fixed_${results.length}.mp4`;
      console.log(`    APPLY WATERMARK bar HIGH UP 110 logo ${logoPath} teams ${parsed.homeTeam} vs ${parsed.awayTeam}`);
      applyDynamicWatermark(raw, {
        tournament: parsed.tournament,
        year: parsed.year,
        teamA: parsed.homeTeam,
        teamB: parsed.awayTeam,
        stage: parsed.stage,
        logoPath,
        watermarkPath: profilePic,
        output: watermarked,
        headerHeight:110,
        logoScaleH:100,
        logoPos:"left",
        watermarkPos:"top-right",
        watermarkSize:140,
        watermarkAlpha:0.6,
        crf:30,
        autoDetect:false,
      });
      const wmDur=getDuration(watermarked);
      console.log(`    watermarked dur ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
      // upload and create post
      const publicUrl=await presignUpload(watermarked);
      console.log(`    uploaded ${publicUrl}`);
      const postRes=await createReelPost(content, publicUrl);
      console.log(`    posted ${JSON.stringify(postRes).slice(0,600)}`);
      const postId=postRes.post?._id || postRes._id || postRes.id || "";
      // verify bar logo etc via GET posts/{id}
      await new Promise(r=>setTimeout(r,3000));
      try{
        const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
        const vj=JSON.parse(await vRes.text());
        const post=vj.post||vj;
        console.log(`    verify mediaItems=${post.mediaItems?.length} status=${post.platforms?.[0]?.status}`);
      }catch{}
      results.push({ highlight, content, ytTitle:c.title, ytUrl:highlight.videoUrl, publicUrl, postId, duration:Math.round(dur), watermarkedDuration: wmDur, logo:logoPath, bar:"HIGH UP pad 110px", watermark:"top-right 140px 115" });
      seenHighlights.add(key);
      if(!euroDone && pick.tournament==="Euro" && pick.year===2004) euroDone=true;
      try{fs.unlinkSync(raw);}catch{}
      found=true;
      break;
    }
    if(!found) {
      if(!euroDone) {
        // try alternate Euro 2004 query if first failed
        console.log(`  Euro 2004 failed — trying alternate query`);
        euroPicks[0].query = "Greece Portugal Euro 2004 highlights";
        // don't mark euroDone, retry
      } else console.log(`  No valid candidate for pick ${pick.query} — next attempt`);
    } else {
      if(!euroDone) console.log("*** EURO 2004 POSTED ***");
    }
    await new Promise(r=>setTimeout(r,2000));
  }
  fs.writeFileSync("/tmp/fixed_5_results.json", JSON.stringify(results,null,2));
  console.log("\n=== FIXED 5 DONE ===");
  console.log(JSON.stringify(results,null,2));
  if(results.length<5) console.log(`WARNING only ${results.length}/5 produced`);
  else console.log("SUCCESS 5 aligned posts including Euro 2004");
}
main().catch(e=>{ console.error(e); process.exit(1);});
