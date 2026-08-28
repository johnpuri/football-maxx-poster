import fs from "fs"; import path from "path"; import {execSync} from "child_process"; import {config, requireTournamentLogo} from "./src/config.js"; import {formatPost} from "./src/formatter.js"; import {applyDynamicWatermark} from "./src/watermark.js"; import {parseHighlightFromTitle, validateTripleMatch} from "./src/ytParser.js";
function getDuration(p){ try{ const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim(); return parseFloat(o);}catch{ return null; } }
function ensureProfilePic(){ const p="/tmp/page_profile.jpg"; if(fs.existsSync(p) && fs.statSync(p).size>1000) return p; execSync(`ffmpeg -y -threads 2 -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`); return p; }
async function presignUpload(fp){
  const fn=path.basename(fp); const sz=fs.statSync(fp).size; if(sz<1000000) throw new Error(`file too small ${sz}<1M`);
  const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify({filename:fn, contentType:"video/mp4", size:sz})});
  const t=await r.text(); if(!r.ok) throw new Error(`presign ${r.status}: ${t.slice(0,800)}`); const j=JSON.parse(t);
  const up=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl; const pub=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;
  if(!up) throw new Error(`no uploadUrl ${t.slice(0,500)}`); const finalPub=pub||up.split('?')[0]; if(!finalPub.startsWith("https://media.zernio.com")) throw new Error(`publicUrl not https://media.zernio.com: ${finalPub}`);
  const buf=fs.readFileSync(fp); const put=await fetch(up,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`); return finalPub;
}
async function createReel(content, mediaUrl){
  const body={content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}]};
  const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const t=await r.text(); let j; try{j=JSON.parse(t);}catch{j={raw:t}}; if(!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j).slice(0,800)}`); return j;
}
function downloadYt(id, out){ console.log(`downloading ${id} -> ${out} (low CPU nice)`); execSync(`nice -n 19 yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist -o "${out}" "https://www.youtube.com/watch?v=${id}" 2>&1 | tail -n 5`, {timeout:180000, encoding:"utf8"}); }
function trimToRange(inp, out, target=150){ execSync(`nice -n 19 ffmpeg -y -threads 2 -ss 0 -t ${target} -i "${inp}" -c:v libx264 -preset fast -crf 30 -c:a aac -b:a 96k "${out}" 2>/dev/null || nice -n 19 ffmpeg -y -threads 2 -ss 0 -t ${target} -i "${inp}" -c:v libx264 -preset fast -c:a aac "${out}" 2>/dev/null`, {timeout:90000}); return out; }
function loadPosted(){ const set=new Set(); for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) set.add(k);}catch{} return set; }
function savePosted(set){ const arr=[...set].sort(); for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{} }
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
// SINGLE low-CPU pick: diverse not in posted.json, high likes, native 2-3min, bar HIGH UP 110px, logo mandatory, triple-match, copyright filtered
const pick = { id:"IMtXjuOWpPs", tournament:"Premier League", year:2023, homeTeam:"Chelsea", awayTeam:"Arsenal", stage:"Regular Season", query:"Chelsea vs Arsenal Premier League 2023 Highlights 2-2", ytTitle:"Chelsea 2-2 Arsenal | HIGHLIGHTS | Premier League 2023/24", view_count:1854321, like_count:12453, duration:118 };
async function main(){
  console.log("=== POST 1 LOW CPU: single ffmpeg -threads 2 -preset fast, bar HIGH UP 110px, logo mandatory, triple-match, copyright filtered ===");
  const posted=loadPosted(); console.log(`posted size ${posted.size}`);
  const ht=normalizeTeam(pick.homeTeam), at=normalizeTeam(pick.awayTeam); const tNorm=pick.tournament.toLowerCase().replace(/\s+/g,"-");
  const keys=[`historic-${tNorm}-${pick.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${pick.year}_${tNorm}`, `${ht}_vs_${at}_${pick.year}`];
  if(keys.some(k=>posted.has(k))){ console.error(`DUPLICATE for ${pick.tournament} ${pick.year} ${pick.homeTeam} vs ${pick.awayTeam}`); process.exit(1); }
  console.log(`no duplicate OK: ${pick.tournament} ${pick.year} ${pick.homeTeam} vs ${pick.awayTeam} views=${pick.view_count} likes=${pick.like_count} dur=${pick.duration}`);
  // copyright filter: ban FIFA WC Final / Euro Final etc
  const combined = `${pick.ytTitle} ${pick.tournament}`.toLowerCase();
  if(/world cup.*final/i.test(combined) || /fifa.*final/i.test(combined)){ console.error("copyright high-risk blocked"); process.exit(1); }
  const profilePic=ensureProfilePic();
  const raw=`/tmp/post1low_raw_${pick.id}.mp4`;
  const trimmed=`/tmp/post1low_trim.mp4`;
  const watermarked=`/tmp/post1low_wm.mp4`;
  if(!fs.existsSync(raw) || fs.statSync(raw).size<10000){ try{ downloadYt(pick.id, raw); }catch(e){ console.error("download fail", e.message.slice(0,600)); process.exit(1); } }
  let dur=getDuration(raw); console.log(` raw dur ${dur?.toFixed(1)}s size ${Math.round(fs.statSync(raw).size/1024/1024)}MB`);
  let srcForWm=raw;
  if(dur>210){ console.log(` trimming ${dur.toFixed(1)} -> 150s low CPU`); trimToRange(raw, trimmed, 150); srcForWm=trimmed; dur=getDuration(srcForWm); console.log(` trimmed dur ${dur?.toFixed(1)}s`); }
  if(dur<90 || dur>210){ console.error(` out of range ${dur}, abort`); process.exit(1); }
  let parsed = parseHighlightFromTitle(pick.ytTitle, {fallbackYear:pick.year, fallbackTournament:pick.tournament});
  parsed.homeTeam=pick.homeTeam; parsed.awayTeam=pick.awayTeam; parsed.tournament=pick.tournament; parsed.year=pick.year; parsed.stage=pick.stage;
  const highlight={ id:`post1low-${pick.tournament.toLowerCase().replace(/\s+/g,"-")}-${pick.year}-${pick.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${pick.awayTeam.toLowerCase().replace(/\s+/g,"-")}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${parsed.year}-07-01`, stage:parsed.stage, ytTitle:pick.ytTitle, candidateTitle:pick.ytTitle, videoUrl:`https://www.youtube.com/watch?v=${pick.id}`, thumbnail:`https://img.youtube.com/vi/${pick.id}/hqdefault.jpg`, source:"yt-dlp-post1-lowcpu", ytId:pick.id };
  const content=formatPost(highlight); console.log(` content preview: ${content.slice(0,120)}`);
  const watermarkTexts={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage };
  const triple=validateTripleMatch(parsed, pick.ytTitle, content, watermarkTexts); console.log(` triple ${triple.ok? "OK": "FAIL "+triple.reason}`); if(!triple.ok) process.exit(1);
  let logoPath; try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); const buf=fs.readFileSync(logoPath); if(!(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf.length>=500)) throw new Error("invalid PNG"); }catch(e){ console.error("logo mandatory fail",e.message); process.exit(1); }
  console.log(` logo ${path.basename(logoPath)} mandatory OK, HIGH UP 110px, single ffmpeg -threads 2 -preset fast`);
  try{
    // single ffmpeg via applyDynamicWatermark with -threads 2 -preset fast (patched)
    applyDynamicWatermark(srcForWm, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:watermarked, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false });
  }catch(e){ console.error("watermark fail", e.message.slice(0,600)); process.exit(1); }
  const wmDur=getDuration(watermarked); console.log(` watermarked dur ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB single ffmpeg low CPU`);
  const pubUrl=await presignUpload(watermarked); console.log(` uploaded strict ${pubUrl}`);
  const postRes=await createReel(content, pubUrl);
  const postId=postRes.post?._id || postRes._id || postRes.id || postRes.post?.id || ""; console.log(` posted ${postId} ${JSON.stringify(postRes).slice(0,400)}`);
  await new Promise(r=>setTimeout(r,5000));
  let verified=false, status=""; try{ const v=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}}); const vj=JSON.parse(await v.text()); const post=vj.post||vj; const hasVideo=(post.mediaItems||[]).length===1 && post.mediaItems[0].type==="video"; status=post.platforms?.[0]?.status; verified=hasVideo && status==="published"; console.log(` verify hasVideo=${hasVideo} status=${status} => ${verified} mediaItems=${JSON.stringify(post.mediaItems||[]).slice(0,200)}`); }catch(e){ console.log(" verify err", e.message.slice(0,300)); }
  if(!verified){ console.error(`NOT VERIFIED status=${status}, abort not marking posted`); process.exit(1); }
  posted.add(highlight.id); for(const k of keys) posted.add(k); savePosted(posted);
  const result={pick, duration:Math.round(wmDur), views:pick.view_count, likes:pick.like_count, publicUrl:pubUrl, postId, verified, lowCPU:true, ffmpeg:"single -threads 2 -preset fast", bar:"HIGH UP 110px", logo:path.basename(logoPath)};
  fs.writeFileSync("/tmp/post1low_results.json", JSON.stringify(result,null,2));
  console.log("=== DONE LOW CPU 1 POST VERIFIED ==="); console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{ console.error(e); process.exit(1); });
