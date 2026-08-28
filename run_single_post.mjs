import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { finalToHighlight } from "./src/historical.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { validateHighlight } from "./src/validate.js";

function getDuration(p){
  try{
    const out=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim();
    const d=parseFloat(out); if(!isNaN(d)) return d;
  }catch{}
  return null;
}
function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
  try{
    const url="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";
    execSync(`curl -s -L "${url}" -o "${p}"`,{timeout:15000});
    if(fs.existsSync(p)) return p;
  }catch{}
  try{ execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);}catch{}
  return p;
}
async function presignUpload(filePath){
  const filename=path.basename(filePath);
  const size=fs.statSync(filePath).size;
  const body={filename, contentType:"video/mp4", size};
  const res=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const text=await res.text();
  if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,800)}`);
  const j=JSON.parse(text);
  const uploadUrl=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl;
  const publicUrl=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;
  if(!uploadUrl) throw new Error(`presign missing uploadUrl: ${text.slice(0,800)}`);
  const finalUrl=publicUrl||uploadUrl.split('?')[0];
  const buf=fs.readFileSync(filePath);
  const put=await fetch(uploadUrl,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);
  return finalUrl;
}
async function createReelPost(content, mediaUrl){
  const payloads=[
    {content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}]},
    {content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaUrls:[mediaUrl]},
  ];
  for(const body of payloads){
    const res=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const text=await res.text();
    let j; try{j=JSON.parse(text)}catch{j={raw:text}}
    if(res.ok) return j;
    if(res.status===400) continue;
    throw new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
  }
  throw new Error("post failed");
}

const raw="/tmp/footballmaxx_historic-euro-2000-france-vs-italy.mp4";
const tournament="Euro";
const year=2000;
const homeTeam="France";
const awayTeam="Italy";
const stage="Final";
const ytUrl="https://www.youtube.com/watch?v=knul03Emmwk";

console.log(`raw exists=${fs.existsSync(raw)} size=${fs.existsSync(raw)?Math.round(fs.statSync(raw).size/1024/1024)+"MB":"no"}`);
console.log(`duration ${getDuration(raw)}s`);
const logoPath=requireTournamentLogo(tournament, year);
console.log(`logo ${logoPath} exists=${fs.existsSync(logoPath)} size=${fs.statSync(logoPath).size}`);
const buf=fs.readFileSync(logoPath);
console.log(`logo valid PNG=${buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47} len=${buf.length}`);

// validate before watermark
const hlBase=finalToHighlight({tournament, year, homeTeam, awayTeam, title:`Euro 2000 Final — France vs Italy`}, ytUrl);
hlBase.league=`${tournament} ${year}`;
hlBase.title=`Euro 2000 Final — France vs Italy`;
hlBase.date=`${year}-07-01`;
hlBase.tournament=tournament;
hlBase.year=year;
const vBefore=await validateHighlight({...hlBase, thumbnail:`https://img.youtube.com/vi/knul03Emmwk/hqdefault.jpg`, candidateTitle: hlBase.title, ytTitle: hlBase.title}, {localVideoPath: raw});
console.log(`validate before watermark: valid=${vBefore.valid} reason=${vBefore.reason}`);
if(!vBefore.valid) { console.error("validate failed before watermark"); process.exit(1); }

const profilePic=ensureProfilePic();
console.log(`profilePic ${profilePic} ${fs.statSync(profilePic).size} bytes`);

const watermarked=`/tmp/hist_wm_euro2000_${Date.now()}.mp4`;
console.log(`Applying watermark HIGH UP (header 110, extended canvas above video, not overlapping) ...`);
applyDynamicWatermark(raw, {
  tournament, year, teamA: homeTeam, teamB: awayTeam, stage,
  logoPath, watermarkPath: profilePic, output: watermarked,
  headerHeight:110, logoScaleH:100, logoPos:"left",
  watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6,
  crf:30, autoDetect:false,
});
console.log(`watermarked ${watermarked} dur=${getDuration(watermarked)?.toFixed(1)}s size=${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
const wmDur=getDuration(watermarked);
if(wmDur<60 || wmDur>250){ console.error(`wm duration invalid ${wmDur}`); process.exit(1); }

// validate watermarked
const vAfter=await validateHighlight({...hlBase, thumbnail:`https://img.youtube.com/vi/knul03Emmwk/hqdefault.jpg`, candidateTitle: hlBase.title, ytTitle: hlBase.title}, {localVideoPath: watermarked});
console.log(`validate after watermark: valid=${vAfter.valid} reason=${vAfter.reason}`);

const content=formatPost(hlBase);
console.log(`\n--- CONTENT ---\n${content}\n---`);
if(/youtube\.com|youtu\.be/i.test(content)) throw new Error("youtube in content!");

console.log(`Presign upload ...`);
const publicUrl=await presignUpload(watermarked);
console.log(`uploaded -> ${publicUrl}`);

console.log(`Creating reel post ...`);
const postRes=await createReelPost(content, publicUrl);
console.log(`post response ${JSON.stringify(postRes).slice(0,1200)}`);
const postId=postRes.post?._id||postRes._id||postRes.id||"";
console.log(`postId=${postId}`);

await new Promise(r=>setTimeout(r,7000));
const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
const vText=await vRes.text();
let vj; try{vj=JSON.parse(vText)}catch{vj={raw:vText}}
const post=vj.post||vj;
console.log(`verify status=${post.status} mediaItems=${post.mediaItems?.length} type=${post.mediaItems?.[0]?.type} platformStatus=${post.platforms?.[0]?.status} url=${post.platforms?.[0]?.platformPostUrl}`);
const verified = post.status==="published" && post.mediaItems?.length>0 && post.mediaItems[0].type==="video" && post.platforms?.[0]?.status==="published" && !!post.platforms?.[0]?.platformPostUrl;
console.log(verified ? "✓ VERIFIED" : "✗ NOT VERIFIED "+JSON.stringify(post).slice(0,1500));

try{
  const postedFile="./posted.json";
  let posted=new Set();
  try{ posted=new Set(JSON.parse(fs.readFileSync(postedFile,"utf8"))); }catch{}
  posted.add(hlBase.id);
  fs.writeFileSync(postedFile, JSON.stringify([...posted],null,2));
  console.log(`Saved ${hlBase.id} to posted.json`);
}catch(e){ console.warn(e.message); }

if(!verified){ console.error("Not verified"); process.exit(1); }
console.log("=== SUCCESS ===");
