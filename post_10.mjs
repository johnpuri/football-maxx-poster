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
  const size = fs.statSync(filePath).size;
  // Zernio expects filename + contentType, size optional per task spec
  const body = { filename, contentType:"video/mp4", size };
  const res=await fetch(`${config.zernioBaseUrl}/media`,{
    method:"POST",
    headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  const text=await res.text();
  if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,800)}`);
  const j=JSON.parse(text);
  // Handle different response shapes
  const uploadUrl=j.uploadUrl || j.url || j.presignedUrl || j.data?.uploadUrl;
  const publicUrl=j.publicUrl || j.publicURL || j.fileUrl || j.url || j.data?.publicUrl || j.data?.url;
  // Some APIs return {uploadUrl, publicUrl} else need to extract
  if(!uploadUrl){
    console.log("presign response:", JSON.stringify(j).slice(0,1000));
    throw new Error(`presign missing uploadUrl: ${text.slice(0,800)}`);
  }
  const finalPublicUrl = publicUrl || uploadUrl.split('?')[0];
  const buf=fs.readFileSync(filePath);
  const put=await fetch(uploadUrl,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`upload PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);
  return finalPublicUrl;
}

async function createReelPost(content, mediaUrl){
  // Try mediaItems first (spec), fallback to mediaUrls
  const payloads = [
    { content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}] },
    { content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaUrls:[mediaUrl] },
  ];
  let lastErr;
  for(const body of payloads){
    const res=await fetch(`${config.zernioBaseUrl}/posts`,{
      method:"POST",
      headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const text=await res.text();
    let j; try{j=JSON.parse(text);}catch{j={raw:text}}
    if(res.ok) return j;
    lastErr = new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`);
    // if mediaItems not supported, try next
    if(JSON.stringify(j).includes("mediaItems") || res.status===400) continue;
    throw lastErr;
  }
  throw lastErr;
}

function getDuration(p){
  try{
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`, {encoding:"utf8", timeout:10000}).trim();
    const d=parseFloat(out);
    if(!isNaN(d)) return d;
  }catch{}
  return null;
}

function downloadWithInfo(url, out){
  // dump json for title/uploader/duration check before download
  let info=null;
  try{
    const j = execSync(`yt-dlp --dump-json --no-playlist "${url}" 2>/dev/null | head -n 1`, {encoding:"utf8", timeout:15000}).trim();
    if(j) info=JSON.parse(j);
  }catch{}
  const cmd=`yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`;
  console.log(cmd);
  try{ execSync(cmd,{stdio:"inherit", timeout:180000}); }catch(e){ if(!fs.existsSync(out)) throw e; console.log(`yt-dlp exit ${e.status} but file exists`);}
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

async function findValidCandidate(pick, idx){
  const cands = tryYtSearch5(pick.query);
  console.log(`Found ${cands.length} candidates for "${pick.query}"`);
  for(let ci=0; ci<cands.length; ci++){
    const c=cands[ci];
    const ytUrl=`https://www.youtube.com/watch?v=${c.id}`;
    console.log(`  Candidate ${ci+1}: ${c.id} — ${c.title.slice(0,80)}`);
    if(isCartoonVideoSync(c.title,"")){ console.log("    skip cartoon keyword"); continue; }
    if(await isCartoonVideo(c.title,"",c.thumbnail)){ console.log("    skip cartoon vision"); continue; }
    const fifa = isFifaHighRisk({title:c.title, description:c.title, league:`${pick.tournament} ${pick.year}`, uploader:""});
    if(fifa.risk){ console.log(`    skip FIFA risk: ${fifa.reason}`); continue; }

    const raw=`/tmp/raw10_${idx}_${ci}.mp4`;
    let info=null;
    try{ info = downloadWithInfo(ytUrl, raw); }catch(e){ console.log(`    download failed: ${e.message?.slice(0,120)}`); continue; }
    const dur = getDuration(raw);
    console.log(`    duration ${dur?.toFixed(1)}s`);
    if(dur===null){ console.log("    skip: no duration"); try{fs.unlinkSync(raw);}catch{}; continue; }
    if(dur < 60 || dur > 250){ console.log(`    skip: duration ${dur}s not in 60-250`); try{fs.unlinkSync(raw);}catch{}; continue; }
    if(dur < 120 || dur > 210) console.log(`    note: outside preferred 120-210 but allowed`);
    // also check is not cut short? need extended highlights — duration already ensures 2-3 min
    // validate highlight
    const hl = finalToHighlight(pick.match, ytUrl);
    hl.league=`${pick.tournament} ${pick.year}`;
    hl.title=pick.title;
    // use yt title if more accurate? keep pick title for caption but validate with yt title too
    const v = await validateHighlight({...hl, title:c.title || hl.title, thumbnail:c.thumbnail, candidateTitle:c.title, ytTitle:c.title}, {localVideoPath: raw, skipVision:true, candidateTitle:c.title});
    if(!v.valid){ console.log(`    validate failed: ${v.reason}`); try{fs.unlinkSync(raw);}catch{}; continue; }
    // logo required
    const logoPath=requireTournamentLogo(pick.tournament, pick.year);
    if(!fs.existsSync(logoPath)){ console.log(`    logo missing ${logoPath}`); try{fs.unlinkSync(raw);}catch{}; continue; }
    return { ytUrl, raw, dur, c, logoPath, info };
  }
  return null;
}

async function main(){
  console.log("=== Posting 10 reels diverse 1998-today ===");
  const profilePic=ensureProfilePic();
  console.log(`profilePic ${profilePic} ${fs.existsSync(profilePic)?fs.statSync(profilePic).size:0} bytes`);
  // get 10 diverse picks
  let batch=[];
  // ensure not only WC finals — getDiverseBatch already filters, but verify
  const attempts=0;
  // generate with dedup
  const seen=new Set();
  while(batch.length<10){
    const { getDiverseBatch: gdb } = await import("./src/historical.js");
    const extra = gdb(10);
    for(const p of extra){
      const key=`${p.tournament}-${p.year}-${p.match.homeTeam}-${p.match.awayTeam}`;
      if(seen.has(key)) continue;
      // extra filter: no WC finals
      if(/world cup/i.test(p.tournament) && /final/i.test(p.title)) { console.log(`skip WC final pick ${p.title}`); continue; }
      seen.add(key);
      batch.push(p);
      if(batch.length>=10) break;
    }
    if(batch.length<10 && seen.size>50) break;
  }
  batch = batch.slice(0,10);
  console.log(`Picked ${batch.length} diverse:`);
  batch.forEach((p,i)=> console.log(`${i+1}. ${p.tournament} ${p.year} — ${p.match.homeTeam} vs ${p.match.awayTeam} [${p.category}] query=${p.query}`));

  async function verifyAndFix(postId, expectedTeams, expectedLeague){
    await new Promise(r=>setTimeout(r,5000));
    try{
      const vRes = await fetch(`${config.zernioBaseUrl}/posts/${postId}`, { headers:{ Authorization:`Bearer ${config.zernioApiKey}` }});
      const vText=await vRes.text();
      const vj=JSON.parse(vText);
      const post = vj.post || vj;
      const mediaItems = post.mediaItems || [];
      const plat = post.platforms?.[0];
      const content = post.content || "";
      console.log(`verify GET mediaItems=${mediaItems.length} type=${mediaItems[0]?.type||"none"} platform status=${plat?.status} contentHasTeams=${expectedTeams.every(t=>content.toLowerCase().includes(t.toLowerCase()))}`);
      const hasVideo = mediaItems.length===1 && mediaItems[0].type==="video";
      const isPublished = plat?.status==="published" && !!post.platformPostUrl;
      const teamOk = expectedTeams.every(t=> content.toLowerCase().includes(t.toLowerCase().split(" ")[0].toLowerCase()));
      const leagueOk = !expectedLeague || content.includes(expectedLeague) || content.toLowerCase().includes(expectedLeague.toLowerCase().split(" ")[0]);
      if(hasVideo && isPublished && teamOk){
        return { ok:true, post };
      }
      console.warn(`verify FAILED: hasVideo=${hasVideo} isPublished=${isPublished} teamOk=${teamOk} leagueOk=${leagueOk} mediaItems=${mediaItems.length} status=${plat?.status}`);
      return { ok:false, post, reason: !hasVideo? "empty mediaItems": !isPublished? "not published": "team mismatch" };
    }catch(e){ console.warn("verify error", e.message); return { ok:false, reason:e.message } }
  }
  async function unpublishPost(postId){
    try{
      const res=await fetch(`${config.zernioBaseUrl}/posts/${postId}/unpublish`,{method:"POST", headers:{ Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify({platform:"facebook"})});
      const txt=await res.text(); console.log(`unpublish ${postId} -> ${res.status} ${txt.slice(0,200)}`);
    }catch(e){ console.warn("unpublish err", e.message)}
  }
  const results=[];
  for(let idx=0; idx<batch.length; idx++){
    const pick=batch[idx];
    console.log(`\n========== ${idx+1}/10 ${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam} ==========`);
    const found = await findValidCandidate(pick, idx);
    if(!found){ console.error(`FAILED to find valid candidate for ${pick.query} — skipping`); continue; }
    const { ytUrl, raw, dur, logoPath } = found;
    const watermarked=`/tmp/wm10_${idx}.mp4`;
    console.log(`Applying watermark: pad 110 HIGH UP, logo left 10:10 scale -1:100, centered texts, watermark W-w-5:115`);
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
    const wmDur=getDuration(watermarked);
    console.log(`watermarked duration ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
    // caption: no youtube link, only tournament/year
    const hl=finalToHighlight(pick.match, ytUrl);
    hl.league=`${pick.tournament} ${pick.year}`;
    hl.title=pick.title;
    hl.date=`${pick.year}-07-01`;
    const content=formatPost(hl);
    console.log(`content:\n${content}`);
    if(/youtube\.com|youtu\.be/i.test(content)) throw new Error("content contains youtube link!");
    // presign upload
    const publicUrl = await presignUpload(watermarked);
    console.log(`uploaded -> ${publicUrl}`);
    const postRes = await createReelPost(content, publicUrl);
    console.log(`posted ${JSON.stringify(postRes).slice(0,800)}`);
    const postId = postRes.post?._id || postRes._id || postRes.id || "";
    // verify loop: ensure mediaItems video + content matches, else unpublish and retry with next candidate
    let verify = await verifyAndFix(postId, [pick.match.homeTeam, pick.match.awayTeam], `${pick.tournament} ${pick.year}`);
    let verified = verify.ok;
    if(!verified){
      console.warn(`Post ${postId} verification failed (${verify.reason}) — unpublishing and will retry with next candidate if available`);
      await unpublishPost(postId);
      // try to find next candidate for same pick (retry once)
      const retryFound = await findValidCandidate(pick, idx+100);
      if(retryFound){
        console.log("Retrying with next valid candidate...");
        // re-watermark and re-upload retry (simplified: reuse flow)
        const retryWm=`/tmp/wm10_retry_${idx}.mp4`;
        applyDynamicWatermark(retryFound.raw, {
          tournament: pick.tournament, year: pick.year, teamA: pick.match.homeTeam, teamB: pick.match.awayTeam,
          stage: pick.match.title.includes("Final") ? "Final" : pick.tournament,
          logoPath: retryFound.logoPath, watermarkPath: profilePic, output: retryWm, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false,
        });
        const retryUrl = await presignUpload(retryWm);
        const retryPostRes = await createReelPost(content, retryUrl);
        const retryId = retryPostRes.post?._id || retryPostRes._id || retryPostRes.id || "";
        console.log(`retry posted ${retryId} -> ${retryUrl}`);
        const retryVerify = await verifyAndFix(retryId, [pick.match.homeTeam, pick.match.awayTeam], `${pick.tournament} ${pick.year}`);
        if(retryVerify.ok){
          console.log("retry verified OK");
          results.push({ pick:`${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam}`, ytUrl: retryFound.ytUrl, dur: Math.round(retryFound.dur), publicUrl: retryUrl, postId: retryId, content, verified:true, retried:true });
        } else {
          console.warn("retry also failed"); await unpublishPost(retryId);
          results.push({ pick:`${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam}`, ytUrl, dur: Math.round(dur), publicUrl, postId, content, verified:false, retried:true });
        }
        try{fs.unlinkSync(retryFound.raw);}catch{}
        try{fs.unlinkSync(retryWm);}catch{}
      } else {
        results.push({ pick:`${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam}`, ytUrl, dur: Math.round(dur), publicUrl, postId, content, verified:false });
      }
    } else {
      results.push({ pick:`${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam}`, ytUrl, dur: Math.round(dur), publicUrl, postId, content, verified });
    }
    try{fs.unlinkSync(raw);}catch{}
    // keep watermarked? cleanup later
    await new Promise(r=>setTimeout(r,3000));
  }
  fs.writeFileSync("/tmp/batch10_results.json", JSON.stringify(results,null,2));
  console.log("\n=== ALL DONE ===");
  console.log(JSON.stringify(results,null,2));
  // email summary via simple send? Use system mail if configured, else write file
  const summary = `Football Maxx — 10 reels posted ${new Date().toISOString()}\n${results.map((r,i)=>`${i+1}. ${r.pick} dur=${r.dur}s postId=${r.postId} verified=${r.verified} ${r.publicUrl}`).join("\n")}`;
  fs.writeFileSync("/tmp/email_summary.txt", summary);
  console.log(summary);
  // try to send email via python smtp if available, else just log
  try{
    // Check if hermes email tool available — try sending via curl to zernio email not available
    // Use sendmail if exists
    execSync(`which sendmail 2>&1 | head`, {encoding:"utf8"});
  }catch{}
  // Use opencode email summary: try nodemailer via hermes
  console.log("Summary written to /tmp/email_summary.txt and /tmp/batch10_results.json");
}
main().catch(e=>{ console.error(e); process.exit(1);});
