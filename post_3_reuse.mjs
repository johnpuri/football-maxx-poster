import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { validateHighlight } from "./src/validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";

function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
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

// Reuse cached raws with correct aligned metadata
// Each entry: raw path, ytTitle (true title of video), fallback year/tournament for parser
const REUSE = [
  {
    raw: "/tmp/euro2008.mp4",
    ytTitle: "Spain vs Germany 1-0 Euro 2008 Final Highlights - Torres Goal",
    // parser should extract Spain/Germany, Euro 2008
  },
  {
    raw: "/tmp/bundes2013_raw.mp4",
    ytTitle: "Bayern Munich vs Borussia Dortmund 2-1 Champions League 2013 Final Highlights",
  },
  {
    raw: "/tmp/epl.mp4",
    ytTitle: "Arsenal vs Manchester United 1-1 Premier League 2004 Highlights",
  },
];

async function main(){
  console.log("=== REUSE 3 reels — single source ytTitle aligned ===");
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} ${fs.existsSync(profilePic)?fs.statSync(profilePic).size:0}`);
  const results=[];
  for(let i=0;i<REUSE.length;i++){
    const r=REUSE[i];
    console.log(`\n--- Reuse ${i+1}: ${r.raw} ytTitle="${r.ytTitle}" ---`);
    if(!fs.existsSync(r.raw)){ console.log(` skip missing ${r.raw}`); continue; }
    const dur=getDuration(r.raw);
    console.log(` raw duration ${dur?.toFixed(1)}s`);
    if(dur===null || dur<60 || dur>250){ console.log(` skip duration`); continue; }
    const parsed=parseHighlightFromTitle(r.ytTitle);
    console.log(` parsed`, parsed);
    if(!parsed.homeTeam || !parsed.awayTeam){ console.log(` skip parse fail`); continue; }
    const highlight={
      id:`reuse-${i}-${Date.now()}`,
      title: `${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,
      league: `${parsed.tournament} ${parsed.year}`,
      homeTeam: parsed.homeTeam,
      awayTeam: parsed.awayTeam,
      tournament: parsed.tournament,
      year: parsed.year,
      date: `${parsed.year}-07-01`,
      stage: parsed.stage,
      ytTitle: r.ytTitle,
      candidateTitle: r.ytTitle,
      videoUrl:`https://www.youtube.com/watch?v=reuse${i}`,
      thumbnail: "",
    };
    const content=formatPost(highlight);
    console.log(` content:\n${content}`);
    if(/youtube\.com|youtu\.be/i.test(content)){ console.log(" skip yt link"); continue; }
    const watermarkTexts={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage: parsed.stage };
    const triple=validateTripleMatch(parsed, r.ytTitle, content, watermarkTexts);
    if(!triple.ok){ console.log(` triple fail ${triple.reason}`); continue; }
    let logoPath;
    try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year);}catch(e){ console.log(` logo missing ${e.message}`); continue; }
    if(!fs.existsSync(logoPath)){ console.log(` logo file missing ${logoPath}`); continue; }
    const buf=fs.readFileSync(logoPath);
    if(!(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47 && buf.length>=500)){ console.log(" invalid PNG"); continue; }
    const v=await validateHighlight({...highlight, title:r.ytTitle, candidateTitle:r.ytTitle, ytTitle:r.ytTitle},{localVideoPath:r.raw, skipVision:true, candidateTitle:r.ytTitle});
    if(!v.valid){ console.log(` validate fail ${v.reason}`); continue; }
    console.log(` validate ok`);
    const watermarked=`/tmp/wm_reuse_${i}.mp4`;
    console.log(` APPLY WATERMARK bar HIGH UP 110 logo ${logoPath}`);
    applyDynamicWatermark(r.raw,{
      tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage,
      logoPath, watermarkPath:profilePic, output:watermarked,
      headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30,
    });
    const wmDur=getDuration(watermarked);
    console.log(` watermarked dur ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
    const publicUrl=await presignUpload(watermarked);
    console.log(` uploaded ${publicUrl}`);
    const postRes=await createReelPost(content, publicUrl);
    console.log(` posted ${JSON.stringify(postRes).slice(0,800)}`);
    const postId=postRes.post?._id || postRes._id || postRes.id || "";
    await new Promise(r=>setTimeout(r,2000));
    try{
      const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
      const vj=JSON.parse(await vRes.text());
      const post=vj.post||vj;
      console.log(` verify mediaItems=${post.mediaItems?.length} status=${post.platforms?.[0]?.status}`);
    }catch{}
    results.push({highlight, content, ytTitle:r.ytTitle, publicUrl, postId, duration:Math.round(dur), logo:logoPath, bar:"HIGH UP 110", watermark:"top-right 140"});
    await new Promise(r=>setTimeout(r,1500));
  }
  fs.writeFileSync("/tmp/reuse_3_results.json", JSON.stringify(results,null,2));
  console.log("\n=== REUSE 3 DONE ===");
  console.log(JSON.stringify(results,null,2));
  if(results.length<3) console.log(`WARNING only ${results.length}/3`);
  else console.log("SUCCESS 3 aligned posts");
}
main().catch(e=>{ console.error(e); process.exit(1);});
