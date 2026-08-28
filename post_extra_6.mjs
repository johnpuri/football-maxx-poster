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
function cleanParsed(parsed){
  // fix awayTeam trailing digit from score artifact like "Germany 1" or "Borussia Dortmund 2"
  // parseHighlight should already strip but we add safety
  let { homeTeam, awayTeam } = parsed;
  // strip trailing single digit if preceded by space and original title had score
  awayTeam = awayTeam.replace(/\s+\d+$/,"").trim();
  homeTeam = homeTeam.replace(/\s+\d+$/,"").trim();
  // also strip trailing " 1-0" remnants
  awayTeam = awayTeam.split(/\s+\d+[-:]\d+/)[0].trim();
  return { ...parsed, homeTeam, awayTeam };
}

const extra=[
  { raw:"/tmp/epl.mp4", ytTitle:"Man City vs Arsenal Premier League 2023 Highlights 2-1", fallbackYear:2023, fallbackTournament:"Premier League" },
  { raw:"/tmp/copa.mp4", ytTitle:"Argentina vs Brazil Copa America 2021 Final Highlights", fallbackYear:2021, fallbackTournament:"Copa America" },
  { raw:"/tmp/europa2021_raw.mp4", ytTitle:"Villarreal vs Manchester United Europa League 2021 Final Highlights", fallbackYear:2021, fallbackTournament:"Europa League" },
  { raw:"/tmp/facup2022_raw.mp4", ytTitle:"Liverpool vs Chelsea FA Cup 2022 Final Highlights", fallbackYear:2022, fallbackTournament:"FA Cup" },
  { raw:"/tmp/hist_1998_World_Cup_trim90.mp4", ytTitle:"Brazil vs Netherlands World Cup 1998 Semi Highlights", fallbackYear:1998, fallbackTournament:"World Cup" },
  { raw:"/tmp/hist_2010_trim90.mp4", ytTitle:"Spain vs Netherlands World Cup 2010 Highlights", fallbackYear:2010, fallbackTournament:"World Cup" },
  { raw:"/tmp/hist_2006_trim90.mp4", ytTitle:"Italy vs France World Cup 2006 Highlights", fallbackYear:2006, fallbackTournament:"World Cup" },
  { raw:"/tmp/bundes2013_fix_raw.mp4", ytTitle:"Bayern Munich vs Borussia Dortmund Bundesliga 2025 Highlights", fallbackYear:2025, fallbackTournament:"Bundesliga" },
];

async function main(){
  console.log("=== REUSE extra 6-8 reels ===");
  const profilePic=ensureProfilePic();
  const results=[];
  for(let i=0;i<extra.length && results.length<6;i++){
    const cand=extra[i];
    console.log(`\n--- ${cand.raw} "${cand.ytTitle}" ---`);
    if(!fs.existsSync(cand.raw)){ console.log(" missing"); continue; }
    let parsed = parseHighlightFromTitle(cand.ytTitle, { fallbackYear: cand.fallbackYear, fallbackTournament: cand.fallbackTournament });
    parsed = cleanParsed(parsed);
    console.log(`  parsed ${parsed.tournament} ${parsed.year} ${parsed.homeTeam} vs ${parsed.awayTeam} stage=${parsed.stage}`);
    if(!parsed.homeTeam || !parsed.awayTeam){ console.log(" parse fail"); continue; }
    const highlight={ id:`reuse-extra-${i}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${parsed.year}-07-01`, stage:parsed.stage, ytTitle:cand.ytTitle, candidateTitle:cand.ytTitle, videoUrl:`https://www.youtube.com/watch?v=extra${i}`, embedUrl:`https://www.youtube.com/watch?v=extra${i}`, thumbnail:"", source:"reuse-extra", ytId:`extra${i}` };
    const content=formatPost(highlight);
    console.log(`  content ${content.split("\n")[0]}`);
    const watermarkTexts={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage: parsed.stage };
    const triple=validateTripleMatch(parsed, cand.ytTitle, content, watermarkTexts);
    if(!triple.ok){ console.log(` triple fail ${triple.reason}`); continue; }
    let logoPath; try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log(` logo fail ${e.message}`); continue; }
    if(!fs.existsSync(logoPath)){ console.log(" logo missing"); continue; }
    const dur=getDuration(cand.raw);
    console.log(`  dur ${dur?.toFixed(1)}s`);
    const watermarked=`/tmp/wm_extra_${results.length}.mp4`;
    applyDynamicWatermark(cand.raw, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:watermarked, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false });
    const wmDur=getDuration(watermarked);
    console.log(`  watermarked ${wmDur?.toFixed(1)}s`);
    const publicUrl=await presignUpload(watermarked);
    console.log(`  uploaded ${publicUrl}`);
    const postRes=await createReelPost(content, publicUrl);
    const postId=postRes.post?._id || postRes._id || postRes.id || "";
    console.log(`  posted ${postId}`);
    await new Promise(r=>setTimeout(r,3000));
    let verified=false;
    try{
      const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
      const vj=JSON.parse(await vRes.text()); const post=vj.post||vj;
      const hasVideo=(post.mediaItems||[]).length===1 && post.mediaItems[0].type==="video";
      const status=post.platforms?.[0]?.status;
      const norm=s=>s.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
      const ytOk=norm(cand.ytTitle).includes(norm(parsed.homeTeam)) && norm(cand.ytTitle).includes(norm(parsed.awayTeam));
      const barOk=norm(watermarkTexts.matchText).includes(norm(parsed.homeTeam)) && norm(watermarkTexts.matchText).includes(norm(parsed.awayTeam));
      const contentGot=post.content||"";
      const contentOk=norm(contentGot).includes(norm(parsed.homeTeam)) && norm(contentGot).includes(norm(parsed.awayTeam));
      verified=hasVideo && ytOk && barOk && contentOk && status==="published";
      console.log(`  verify hasVideo=${hasVideo} ytOk=${ytOk} barOk=${barOk} contentOk=${contentOk} status=${status} => ${verified}`);
    }catch(e){ console.log(" verify err", e.message); }
    results.push({ parsed, ytTitle:cand.ytTitle, content, watermarkTexts, logo:path.basename(logoPath), duration:Math.round(dur||0), publicUrl, postId, verified });
    await new Promise(r=>setTimeout(r,1000));
  }
  fs.writeFileSync("/tmp/reuse_extra_results.json", JSON.stringify(results,null,2));
  console.log("\n=== EXTRA DONE ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{ console.error(e); process.exit(1);});
