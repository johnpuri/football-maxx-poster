import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./config.js";
import { getDiverseBatch, finalToHighlight } from "./historical.js";
import { formatPost } from "./formatter.js";
import { applyDynamicWatermark } from "./watermark.js";
import { isCartoonVideoSync } from "./cartoonFilter.js";

// Ensure watermark profile exists
function ensureProfilePic(){
  const p="/tmp/page_profile.jpg";
  if(fs.existsSync(p)) return p;
  // try to download from Facebook page profile picture via Zernio account info or fallback to placeholder
  try{
    // fetch profile pic via known URL (from posts.json)
    const url="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";
    execSync(`curl -s -L "${url}" -o "${p}"`,{timeout:15000});
    if(fs.existsSync(p)) return p;
  }catch{}
  // create blank placeholder 140x140 white
  try{ execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);}catch{}
  return p;
}

async function presignUpload(filePath){
  const filename=path.basename(filePath);
  const res=await fetch(`${config.zernioBaseUrl}/media`,{
    method:"POST",
    headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},
    body: JSON.stringify({ filename, contentType:"video/mp4"})
  });
  const text=await res.text();
  if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,500)}`);
  const j=JSON.parse(text);
  const uploadUrl=j.uploadUrl; const publicUrl=j.publicUrl;
  if(!uploadUrl||!publicUrl) throw new Error(`presign missing urls: ${text.slice(0,500)}`);
  // PUT file
  const buf=fs.readFileSync(filePath);
  const put=await fetch(uploadUrl,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`upload PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);
  return publicUrl;
}

async function createReelPost(content, mediaUrl){
  const body={ content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaUrls:[mediaUrl]};
  const res=await fetch(`${config.zernioBaseUrl}/posts`,{
    method:"POST",
    headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  const text=await res.text();
  let j; try{j=JSON.parse(text);}catch{j={raw:text}}
  if(!res.ok) throw new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
  return j;
}

function ytSearchFilteredSync(query){
  try{
    const out=execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:20000, encoding:"utf8"}).trim();
    const lines=out.split("\n").filter(Boolean);
    const cands=[];
    for(let i=0;i<lines.length-1;i+=2){ const title=lines[i]; const id=lines[i+1]; if(/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({id,title});}
    if(!cands.length){ const ids=out.split("\n").map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{6,}$/.test(s)); for(const id of ids) cands.push({id,title:""});}
    for(const c of cands){ if(isCartoonVideoSync(c.title,"")){ console.log(`[cartoonFilter] skip ${c.id} ${c.title}`); continue;} return `https://www.youtube.com/watch?v=${c.id}`;}
    if(cands.length) return `https://www.youtube.com/watch?v=${cands[0].id}`;
  }catch{}
  try{ const id=execSync(`yt-dlp "ytsearch1:${query}" --get-id --no-warnings 2>/dev/null | head -n1`,{timeout:15000, encoding:"utf8"}).trim(); if(id) return `https://www.youtube.com/watch?v=${id}`;}catch{}
  return "";
}

function downloadViaYtDlp(url, out){
  const cmd=`yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720]+ba/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`;
  console.log(cmd);
  try{ execSync(cmd,{stdio:"inherit", timeout:120000}); }catch(e){ if(!fs.existsSync(out)) throw e; console.log(`yt-dlp exit ${e.status} but file exists, continuing`);}
  if(!fs.existsSync(out)) throw new Error(`download failed ${out}`);
  const dur=parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${out}"`,{encoding:"utf8"}).trim());
  if(dur>240) console.warn(`duration ${dur}s >240 but continuing`);
  return out;
}

async function main(){
  console.log("Batch post 6 videos with tournament logos");
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} exists=${fs.existsSync(profilePic)}`);
  const batch=getDiverseBatch(6);
  console.log(`picked ${batch.length} diverse picks:`);
  batch.forEach((p,i)=> console.log(`${i+1}. ${p.tournament} ${p.year} ${p.match.homeTeam} vs ${p.match.awayTeam} query=${p.query}`));
  const results=[];
  for(let idx=0; idx<batch.length; idx++){
    const pick=batch[idx];
    const logoPath=requireTournamentLogo(pick.tournament, pick.year);
    console.log(`\n=== ${idx+1}/6 ${pick.tournament} ${pick.year} logo=${logoPath} ===`);
    if(!fs.existsSync(logoPath)) throw new Error(`logo missing ${logoPath}`);
    const ytUrl=ytSearchFilteredSync(pick.query);
    if(!ytUrl) throw new Error(`no yt result for ${pick.query}`);
    console.log(`ytUrl ${ytUrl}`);
    const raw=`/tmp/raw_${idx}.mp4`;
    const watermarked=`/tmp/wm_${idx}.mp4`;
    downloadViaYtDlp(ytUrl, raw);
    // Apply dynamic watermark: bar HIGH UP pad 110, logo left 10:10 scale -1:100, centered texts, watermark W-w-5:115
    applyDynamicWatermark(raw, {
      tournament: pick.tournament,
      year: pick.year,
      teamA: pick.match.homeTeam,
      teamB: pick.match.awayTeam,
      stage: pick.match.title.includes("Final") ? "Final" : pick.tournament,
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
    // Re-encode already done in watermark; ensure under 100MB?
    const publicUrl=await presignUpload(watermarked);
    console.log(`uploaded ${publicUrl}`);
    const highlight=finalToHighlight(pick.match, ytUrl);
    // override league/year to ensure accuracy
    highlight.league=`${pick.tournament} ${pick.year}`;
    highlight.title=pick.title;
    highlight.date=`${pick.year}-07-01`;
    const content=formatPost(highlight);
    console.log(`content:\n${content}`);
    if(content.includes("youtube.com")||content.includes("youtu.be")) throw new Error("content contains youtube link!");
    const postRes=await createReelPost(content, publicUrl);
    console.log(`posted ${JSON.stringify(postRes).slice(0,600)}`);
    const postId=postRes.post?._id || postRes._id || postRes.id || "";
    const platformUrl=postRes.post?.platforms?.[0]?.platformPostUrl || postRes.platformPostUrl || "";
    results.push({ pick:`${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam}`, ytUrl, publicUrl, postId, platformUrl, content });
    // small delay to avoid rate limit
    await new Promise(r=>setTimeout(r,3000));
    // cleanup
    try{ fs.unlinkSync(raw);}catch{}
    // keep watermarked for debug?
  }
  fs.writeFileSync("/tmp/batch_results.json", JSON.stringify(results,null,2));
  console.log("\n=== DONE ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{ console.error(e); process.exit(1);});
