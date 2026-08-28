import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getRandomHistoricalPick, finalToHighlight } from "./src/historical.js";
import { formatPost } from "./src/formatter.js";
import { validateHighlight, isFifaHighRisk } from "./src/validate.js";
import { requireTournamentLogo, config } from "./src/config.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { isCartoonVideoSync, isCartoonVideo } from "./src/cartoonFilter.js";

function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
  try{
    const url="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";
    execSync(`curl -s -L "${url}" -o "${p}"`,{timeout:15000});
    if(fs.existsSync(p) && fs.statSync(p).size>1000) return p;
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
  let lastErr;
  for(const body of payloads){
    const res=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const text=await res.text();
    let j; try{j=JSON.parse(text)}catch{j={raw:text}}
    if(res.ok) return j;
    lastErr=new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
    if(res.status===400) continue;
    throw lastErr;
  }
  throw lastErr;
}
function getDuration(p){
  try{
    const out=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim();
    const d=parseFloat(out); if(!isNaN(d)) return d;
  }catch{}
  return null;
}
function ytSearch5(query){
  try{
    const out=execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:25000,encoding:"utf8"}).trim();
    const lines=out.split("\n").filter(Boolean);
    const cands=[];
    for(let i=0;i<lines.length-1;i+=2){ const title=lines[i]; const id=lines[i+1]; if(/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({id,title, thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});}
    if(!cands.length){ const ids=out.split("\n").map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{6,}$/.test(s)); for(const id of ids) cands.push({id,title:"", thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});}
    return cands;
  }catch{ return []; }
}
async function tryCandidates(pick){
  const cands=ytSearch5(pick.query);
  console.log(`ytsearch5 "${pick.query}" -> ${cands.length} candidates`);
  cands.forEach((c,i)=> console.log(`  ${i+1}. ${c.id} — ${c.title.slice(0,90)}`));
  for(let i=0;i<cands.length;i++){
    const c=cands[i];
    const ytUrl=`https://www.youtube.com/watch?v=${c.id}`;
    if(isCartoonVideoSync(c.title,"")){ console.log(`  skip cartoon kw ${c.id}`); continue; }
    if(await isCartoonVideo(c.title,"",c.thumbnail)){ console.log(`  skip cartoon vision ${c.id}`); continue; }
    const fifa=isFifaHighRisk({title:c.title, description:c.title, league:`${pick.tournament} ${pick.year}`, uploader:""});
    if(fifa.risk){ console.log(`  skip FIFA ${c.id}: ${fifa.reason}`); continue; }

    const raw=`/tmp/hist_raw_${Date.now()}_${i}.mp4`;
    try{
      console.log(`  downloading ${ytUrl} -> ${raw}`);
      execSync(`yt-dlp --no-playlist -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${raw}" "${ytUrl}" 2>&1 | tail -n 3`,{timeout:120000, encoding:"utf8"});
    }catch(e){ console.log(`  dl err ${e.message?.slice(0,120)}`); try{fs.unlinkSync(raw)}catch{}; continue; }
    if(!fs.existsSync(raw)){ console.log(`  no file`); continue; }
    const dur=getDuration(raw);
    console.log(`  duration ${dur?.toFixed(1)}s`);
    if(dur===null || dur<60 || dur>250){ console.log(`  skip duration ${dur}`); try{fs.unlinkSync(raw)}catch{}; continue; }

    // logo mandatory
    let logoPath;
    try{ logoPath=requireTournamentLogo(pick.tournament, pick.year); }catch(e){ console.log(`  logo missing ${e.message}`); try{fs.unlinkSync(raw)}catch{}; continue; }
    if(!fs.existsSync(logoPath)){ console.log(`  logo not exists ${logoPath}`); try{fs.unlinkSync(raw)}catch{}; continue; }
    const buf=fs.readFileSync(logoPath);
    if(!(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf.length>=500)){ console.log(`  invalid logo ${logoPath}`); try{fs.unlinkSync(raw)}catch{}; continue; }

    // validateHighlight with video file
    const hl=finalToHighlight(pick.match, ytUrl);
    hl.league=`${pick.tournament} ${pick.year}`;
    // use yt title for validation but keep pick title for caption? formatPost uses ytTitle if present, so set candidateTitle
    const v=await validateHighlight({...hl, title:c.title||hl.title, thumbnail:c.thumbnail, candidateTitle:c.title, ytTitle:c.title}, {localVideoPath: raw, candidateTitle:c.title});
    if(!v.valid){ console.log(`  validate fail: ${v.reason}`); try{fs.unlinkSync(raw)}catch{}; continue; }
    console.log(`  ✓ valid candidate ${c.id} dur ${Math.round(dur)}s`);
    return {raw, dur, ytUrl, c, logoPath, pick};
  }
  return null;
}

async function main(){
  console.log("=== HISTORICAL RANDOM STAGE RUN (fixed: watermark HIGH UP + presign + validate) ===");
  let pick=getRandomHistoricalPick();
  // FIFA safeguard
  let rerolls=0;
  while(pick && /world cup/i.test(pick.tournament) && /final/i.test(pick.title) && rerolls<5){
    console.log(`[FIFA SAFEGUARD] Re-rolling WC Final ${pick.title}`);
    pick=getRandomHistoricalPick(); rerolls++;
  }
  console.log(`[HISTORICAL] Stage=${pick.stage} Tournament=${pick.tournament} Year=${pick.year} Title=${pick.title} Query="${pick.query}" Category=${pick.category}`);

  const res=await tryCandidates(pick);
  if(!res){ console.error(`No valid candidate for "${pick.query}" — trying 4 more random picks`); 
    for(let attempt=0;attempt<4;attempt++){
      const alt=getRandomHistoricalPick();
      console.log(`Retry pick ${attempt+1}: ${alt.tournament} ${alt.year} ${alt.title} stage=${alt.stage}`);
      const r2=await tryCandidates(alt);
      if(r2){ Object.assign(res||{}, r2); if(r2) { res.raw=r2.raw; res.dur=r2.dur; res.ytUrl=r2.ytUrl; res.c=r2.c; res.logoPath=r2.logoPath; pick=alt; break; } }
    }
    if(!res){ console.error("All candidates failed — abort"); process.exit(1); }
  }
  // At this point res is valid
  // Find valid again if res null due to scope issue
  let finalRes=res;
  if(!finalRes){
    console.error("No valid video after retries"); process.exit(1);
  }
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} ${fs.statSync(profilePic).size} bytes`);
  console.log(`logoPath ${finalRes.logoPath}`);

  const watermarked=`/tmp/hist_wm_${Date.now()}.mp4`;
  console.log(`Applying watermark HIGH UP: header 110, extended canvas above video, logo left 10:10`);
  applyDynamicWatermark(finalRes.raw, {
    tournament: pick.tournament,
    year: pick.year,
    teamA: pick.match.homeTeam,
    teamB: pick.match.awayTeam,
    stage: pick.stage || (pick.match.title.includes("Final")?"Final":pick.tournament),
    logoPath: finalRes.logoPath,
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
  console.log(`watermarked ${watermarked} dur ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);

  // validate watermarked file duration too
  if(wmDur===null || wmDur<60 || wmDur>250){ console.error(`Watermarked duration invalid ${wmDur}`); process.exit(1); }

  const hl=finalToHighlight(pick.match, finalRes.ytUrl);
  hl.league=`${pick.tournament} ${pick.year}`;
  hl.title=pick.title;
  hl.date=`${pick.year}-07-01`;
  hl.tournament=pick.tournament;
  hl.year=pick.year;
  hl.homeTeam=pick.match.homeTeam;
  hl.awayTeam=pick.match.awayTeam;
  const content=formatPost(hl);
  console.log(`\n--- CONTENT (no YouTube link) ---\n${content}\n---`);
  if(/youtube\.com|youtu\.be/i.test(content)) throw new Error("content has youtube link!");

  console.log(`Presign upload ${watermarked} ...`);
  const publicUrl=await presignUpload(watermarked);
  console.log(`uploaded -> ${publicUrl}`);

  console.log(`Creating reel post ...`);
  const postRes=await createReelPost(content, publicUrl);
  console.log(`post response ${JSON.stringify(postRes).slice(0,1000)}`);
  const postId=postRes.post?._id||postRes._id||postRes.id||"";
  console.log(`postId=${postId}`);

  // verify
  await new Promise(r=>setTimeout(r,6000));
  const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
  const vText=await vRes.text();
  let vj; try{vj=JSON.parse(vText)}catch{vj={raw:vText}}
  const post=vj.post||vj;
  console.log(`verify status=${post.status} mediaItems=${post.mediaItems?.length} type=${post.mediaItems?.[0]?.type} platformStatus=${post.platforms?.[0]?.status} url=${post.platforms?.[0]?.platformPostUrl?.slice(0,120)}`);
  const verified = post.status==="published" && post.mediaItems?.length>0 && post.mediaItems[0].type==="video" && post.platforms?.[0]?.status==="published" && !!post.platforms?.[0]?.platformPostUrl;
  console.log(verified ? "✓ VERIFIED" : "✗ NOT VERIFIED: "+JSON.stringify(post).slice(0,1500));

  // save to posted.json
  try{
    const postedFile="./posted.json";
    let posted=new Set();
    try{ posted=new Set(JSON.parse(fs.readFileSync(postedFile,"utf8"))); }catch{}
    posted.add(hl.id);
    fs.writeFileSync(postedFile, JSON.stringify([...posted],null,2));
    console.log(`Saved ${hl.id} to posted.json`);
  }catch(e){ console.warn(e.message); }

  // cleanup raw
  try{fs.unlinkSync(finalRes.raw)}catch{}

  if(!verified){
    console.error("Post not verified — exiting 1");
    process.exit(1);
  }
  console.log("=== DONE SUCCESS ===");
}
main().catch(e=>{ console.error(e); process.exit(1); });
