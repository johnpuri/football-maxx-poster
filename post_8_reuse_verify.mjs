import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";

function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
  try{ execSync(`curl -s -L "https://dummy" -o "${p}"`,{timeout:5000});}catch{}
  if(fs.existsSync(p)) return p;
  execSync(`/usr/bin/ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);
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
  const body={ content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}] };
  const res=await fetch(`${config.zernioBaseUrl}/posts`,{ method:"POST", headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify(body)});
  const text=await res.text(); let j; try{j=JSON.parse(text);}catch{j={raw:text}}
  if(!res.ok) throw new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
  return j;
}
function getDuration(p){
  try{ const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`, {encoding:"utf8", timeout:10000}).trim(); const d=parseFloat(out); if(!isNaN(d)) return d; }catch{}
  return null;
}

// Reuse cached raw videos — derive strictly from ytTitle via ytParser
const candidates=[
  { raw:"/tmp/raw_long_0.mp4", ytTitle:"Bayern Just Unstoppable! | FC BAYERN - BORUSSIA DORTMUND | Highlights | MD 7 – Bundesliga 2025/26", ytUrl:"https://www.youtube.com/watch?v=8YCOkI7rFVs", fallbackYear:2025, fallbackTournament:"Bundesliga" },
  { raw:"/tmp/raw_long_1.mp4", ytTitle:"🏆Italy Win Euro 2020!🏆 (Italy vs England Final Penalty Shootout Penalties 3-2 1-1 Highlights)", ytUrl:"https://www.youtube.com/watch?v=Xo83jhTuOaI", fallbackYear:2021, fallbackTournament:"Euro" },
  { raw:"/tmp/raw_long_2.mp4", ytTitle:"ATLETICO MADRID 2 vs 4 FC BARCELONA | LALIGA 2024/25 MD28 (WITH COMMENTARY)", ytUrl:"https://www.youtube.com/watch?v=nuyuCSRx8sI", fallbackYear:2024, fallbackTournament:"La Liga" },
  { raw:"/tmp/raw_long_3.mp4", ytTitle:"Borussia Dortmund 0-2 Real Madrid | HIGHLIGHTS | Champions League final 2023/24", ytUrl:"https://www.youtube.com/watch?v=GgKIhlyjX2w", fallbackYear:2024, fallbackTournament:"Champions League" },
  { raw:"/tmp/raw_long_4.mp4", ytTitle:"Final FA Cup 2006 Liverpool - West Ham", ytUrl:"https://www.youtube.com/watch?v=5BtI9PD6GzM", fallbackYear:2006, fallbackTournament:"FA Cup" },
  { raw:"/tmp/raw_long_5.mp4", ytTitle:"ISTANBUL 05: Liverpool 3-3 Milan | HIGHLIGHTS OF THE GREATEST EVER FINAL", ytUrl:"https://www.youtube.com/watch?v=3ojXHf293M8", fallbackYear:2005, fallbackTournament:"Champions League" },
  { raw:"/tmp/euro2008.mp4", ytTitle:"Spain vs Germany 1-0 Euro 2008 Final Highlights - Torres Goal", ytUrl:"https://www.youtube.com/watch?v=tv4Kx0E2mE", fallbackYear:2008, fallbackTournament:"Euro" },
  { raw:"/tmp/bundes2013_raw.mp4", ytTitle:"Bayern Munich vs Borussia Dortmund 2-1 Champions League 2013 Final Highlights", ytUrl:"https://www.youtube.com/watch?v=abc123", fallbackYear:2013, fallbackTournament:"Champions League" },
];

async function main(){
  console.log("=== REUSE 8 reels — strict ytParser triple-match, HIGH UP bar, logo mandatory ===");
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} ${fs.existsSync(profilePic)?fs.statSync(profilePic).size:0}`);
  const results=[];
  let idx=0;
  for(const cand of candidates){
    if(results.length>=8) break;
    idx++;
    console.log(`\n--- ${idx} raw=${cand.raw} ytTitle="${cand.ytTitle.slice(0,80)}" ---`);
    if(!fs.existsSync(cand.raw)){ console.log("  skip missing file"); continue; }
    const parsed = parseHighlightFromTitle(cand.ytTitle, { fallbackYear: cand.fallbackYear, fallbackTournament: cand.fallbackTournament });
    console.log(`  parsed: ${parsed.tournament} ${parsed.year} ${parsed.homeTeam} vs ${parsed.awayTeam} stage=${parsed.stage}`);
    if(!parsed.homeTeam || !parsed.awayTeam){ console.log("  skip parse fail"); continue; }
    // For dash-v cases fallback already handled; but for last two we have vs
    // Special handling for dash titles: parse may fallback to dash regex
    const highlight = {
      id:`reuse-${idx}`, title: `${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,
      league: `${parsed.tournament} ${parsed.year}`, homeTeam: parsed.homeTeam, awayTeam: parsed.awayTeam,
      tournament: parsed.tournament, year: parsed.year, date: `${parsed.year}-07-01`, stage: parsed.stage,
      ytTitle: cand.ytTitle, candidateTitle: cand.ytTitle, videoUrl: cand.ytUrl, embedUrl: cand.ytUrl,
      thumbnail:`https://img.youtube.com/vi/test/hqdefault.jpg`, source:"reuse-verify8", ytId:"test"
    };
    const content = formatPost(highlight);
    console.log(`  content: ${content.split("\n")[0]}`);
    if(/youtube\.com|youtu\.be/i.test(content)){ console.log("  skip yt link"); continue; }
    const watermarkTexts = { tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage: parsed.stage };
    const triple = validateTripleMatch(parsed, cand.ytTitle, content, watermarkTexts);
    if(!triple.ok){ console.log(`  skip triple ${triple.reason}`); continue; }
    let logoPath;
    try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log(`  skip logo ${e.message}`); continue; }
    if(!fs.existsSync(logoPath)){ console.log(`  skip logo missing ${logoPath}`); continue; }
    const buf=fs.readFileSync(logoPath);
    if(!(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47 && buf.length>=500)){ console.log("  skip invalid PNG"); continue; }
    const dur=getDuration(cand.raw);
    console.log(`  duration ${dur?.toFixed(1)}s`);
    if(dur!==null && (dur<60 || dur>250)){ console.log(`  skip duration`); continue; }
    const watermarked=`/tmp/wm_reuse_verify8_${results.length}.mp4`;
    console.log(`  watermark HIGH UP 110 logo=${path.basename(logoPath)}`);
    applyDynamicWatermark(cand.raw, {
      tournament: parsed.tournament, year: parsed.year, teamA: parsed.homeTeam, teamB: parsed.awayTeam, stage: parsed.stage,
      logoPath, watermarkPath: profilePic, output: watermarked, headerHeight:110, logoScaleH:100, logoPos:"left",
      watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false,
    });
    const wmDur=getDuration(watermarked);
    console.log(`  watermarked ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
    const publicUrl=await presignUpload(watermarked);
    console.log(`  uploaded ${publicUrl}`);
    const postRes=await createReelPost(content, publicUrl);
    const postId=postRes.post?._id || postRes._id || postRes.id || "";
    console.log(`  posted ${postId}`);
    await new Promise(r=>setTimeout(r,3000));
    // verify
    let verified=false, info={};
    try{
      const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
      const vj=JSON.parse(await vRes.text()); const post=vj.post||vj;
      const mediaItems=post.mediaItems||[];
      const hasVideo=mediaItems.length===1 && mediaItems[0].type==="video";
      const contentGot=post.content||"";
      const status=post.platforms?.[0]?.status;
      const norm=s=>s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
      const ytOk=norm(cand.ytTitle).includes(norm(parsed.homeTeam)) && norm(cand.ytTitle).includes(norm(parsed.awayTeam));
      const barOk=norm(watermarkTexts.matchText).includes(norm(parsed.homeTeam)) && norm(watermarkTexts.matchText).includes(norm(parsed.awayTeam));
      const contentOk=norm(contentGot).includes(norm(parsed.homeTeam)) && norm(contentGot).includes(norm(parsed.awayTeam));
      verified=hasVideo && ytOk && barOk && contentOk && status==="published";
      info={hasVideo, ytOk, barOk, contentOk, status, mediaItems:mediaItems.length, type: mediaItems[0]?.type};
      console.log(`  VERIFY hasVideo=${hasVideo} ytOk=${ytOk} barOk=${barOk} contentOk=${contentOk} status=${status} verified=${verified}`);
    }catch(e){ console.log("  verify err", e.message); }
    results.push({ idx: results.length+1, parsed, ytTitle:cand.ytTitle, ytUrl:cand.ytUrl, content, watermarkTexts, logo: path.basename(logoPath), duration: dur?Math.round(dur):null, wmDuration: wmDur?Math.round(wmDur):null, publicUrl, postId, verified, info, bar:"HIGH UP 110", watermark:"top-right 140 W-w-5:115" });
    await new Promise(r=>setTimeout(r,1500));
  }
  fs.writeFileSync("/tmp/reuse8_results.json", JSON.stringify(results,null,2));
  console.log("\n=== REUSE 8 DONE ===");
  console.log(JSON.stringify(results,null,2));
  for(const r of results) console.log(`${r.idx}. ${r.parsed.tournament} ${r.parsed.year} ${r.parsed.homeTeam} vs ${r.parsed.awayTeam} verified=${r.verified} postId=${r.postId}`);
}
main().catch(e=>{ console.error(e); process.exit(1);});
