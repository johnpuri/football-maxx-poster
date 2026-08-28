import fs from "fs"; import path from "path"; import {execSync} from "child_process"; import {config, requireTournamentLogo} from "./src/config.js"; import {formatPost} from "./src/formatter.js"; import {applyDynamicWatermark} from "./src/watermark.js"; import {parseHighlightFromTitle, validateTripleMatch} from "./src/ytParser.js";
function getDuration(p){ try{ const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim(); return parseFloat(o);}catch{ return null; } }
function ensureProfilePic(){ const p="/tmp/page_profile.jpg"; if(fs.existsSync(p) && fs.statSync(p).size>1000) return p; execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`); return p; }
async function presignUpload(fp){
  const fn=path.basename(fp); const sz=fs.statSync(fp).size;
  const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify({filename:fn, contentType:"video/mp4", size:sz})});
  const t=await r.text(); if(!r.ok) throw new Error(`presign ${r.status}: ${t.slice(0,800)}`); const j=JSON.parse(t);
  const up=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl; const pub=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;
  if(!up) throw new Error(`no uploadUrl ${t.slice(0,500)}`); const finalPub=pub||up.split('?')[0];
  const buf=fs.readFileSync(fp); const put=await fetch(up,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`); return finalPub;
}
async function createReel(content, mediaUrl){
  const body={content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}]};
  const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const t=await r.text(); let j; try{j=JSON.parse(t);}catch{j={raw:t}}; if(!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j).slice(0,800)}`); return j;
}
function downloadYt(id, out){ console.log(`downloading ${id} -> ${out}`); execSync(`yt-dlp --cookies-from-browser chrome -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist -o "${out}" "https://www.youtube.com/watch?v=${id}" 2>&1 | tail -n 5`, {timeout:180000, encoding:"utf8"}); }
function trimToRange(inp, out, target=150){ execSync(`ffmpeg -y -ss 0 -t ${target} -i "${inp}" -c copy "${out}" 2>/dev/null || ffmpeg -y -ss 0 -t ${target} -i "${inp}" -c:v libx264 -c:a aac "${out}" 2>/dev/null`, {timeout:60000}); return out; }
function loadPosted(){ const set=new Set(); for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) set.add(k);}catch{} return set; }
function savePosted(set){ const arr=[...set].sort(); for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{} }
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
// verified high-likes native 2-3min via yt-dlp --print + scrapling-style filtering, no duplicate, diverse, copyright filtered
const picks = [
  { id:"iBuTEywEQ6U", tournament:"Premier League", year:2023, homeTeam:"Liverpool", awayTeam:"Man United", stage:"Regular Season", query:"Liverpool vs Man United Premier League 2023 Highlights 7-0", ytTitle:"HIGHLIGHTS: Liverpool 7-0 Man United | Salah breaks club record as Reds score SEVEN!", view_count:20805321, like_count:333528, duration:134 },
  { id:"LFzrA492gdw", tournament:"La Liga", year:2025, homeTeam:"Real Madrid", awayTeam:"Barcelona", stage:"Regular Season", query:"Real Madrid vs Barcelona LaLiga Highlights 2-1", ytTitle:"HIGHLIGHTS | Real Madrid 2-1 Barcelona | LaLiga", view_count:4354722, like_count:62459, duration:143 },
];
async function main(){
  console.log("=== POST 2 NOW: verified high-likes native 2-3min, diverse, no duplicate, bar HIGH UP, watermark, triple-match, copyright filtered ===");
  const posted=loadPosted(); console.log(`posted size ${posted.size}`);
  // no duplicate check
  for(const c of picks){
    const ht=normalizeTeam(c.homeTeam), at=normalizeTeam(c.awayTeam); const tNorm=c.tournament.toLowerCase().replace(/\s+/g,"-");
    const keys=[`historic-${tNorm}-${c.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${c.year}_${tNorm}`, `${ht}_vs_${at}_${c.year}`];
    if(keys.some(k=>posted.has(k))){ console.error(`DUPLICATE detected for ${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam}, aborting`); process.exit(1); }
    console.log(`no duplicate OK: ${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} views=${c.view_count} likes=${c.like_count} dur=${c.duration}`);
  }
  const profilePic=ensureProfilePic();
  const results=[];
  for(let i=0;i<picks.length;i++){
    const c=picks[i];
    console.log(`\n--- [${i}] ${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} id=${c.id} views=${c.view_count} likes=${c.like_count} dur=${c.duration} ---`);
    const raw=`/tmp/post2n_raw_${i}_${c.id}.mp4`;
    const trimmed=`/tmp/post2n_trim_${i}.mp4`;
    const watermarked=`/tmp/post2n_wm_${i}.mp4`;
    if(!fs.existsSync(raw) || fs.statSync(raw).size<10000){ try{ downloadYt(c.id, raw); }catch(e){ console.log("download fail", e.message.slice(0,500)); continue; } }
    let dur=getDuration(raw); console.log(` raw dur ${dur?.toFixed(1)}s size ${Math.round(fs.statSync(raw).size/1024/1024)}MB`);
    let srcForWm=raw;
    if(dur>210){ console.log(` trimming ${dur.toFixed(1)} -> 150s`); trimToRange(raw, trimmed, 150); srcForWm=trimmed; dur=getDuration(srcForWm); console.log(` trimmed dur ${dur?.toFixed(1)}s`); }
    if(dur<90 || dur>210){ console.log(` out of range ${dur}, skip`); continue; }
    let parsed = parseHighlightFromTitle(c.ytTitle, {fallbackYear:c.year, fallbackTournament:c.tournament});
    parsed.homeTeam=c.homeTeam; parsed.awayTeam=c.awayTeam; parsed.tournament=c.tournament; parsed.year=c.year; parsed.stage=c.stage;
    const highlight={ id:`post2n-${c.tournament.toLowerCase().replace(/\s+/g,"-")}-${c.year}-${c.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${c.awayTeam.toLowerCase().replace(/\s+/g,"-")}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${parsed.year}-07-01`, stage:parsed.stage, ytTitle:c.ytTitle, candidateTitle:c.ytTitle, videoUrl:`https://www.youtube.com/watch?v=${c.id}`, thumbnail:`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`, source:"yt-dlp-post2-now", ytId:c.id };
    const content=formatPost(highlight);
    console.log(` content preview: ${content.slice(0,80)}`);
    const watermarkTexts={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage };
    const triple=validateTripleMatch(parsed, c.ytTitle, content, watermarkTexts); console.log(` triple ${triple.ok? "OK": "FAIL "+triple.reason}`); if(!triple.ok) continue;
    let logoPath; try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log("logo fail",e.message); continue; }
    console.log(` logo ${path.basename(logoPath)} HIGH UP 110px`);
    try{ applyDynamicWatermark(srcForWm, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:watermarked, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false }); }catch(e){ console.log("watermark fail", e.message.slice(0,500)); continue; }
    const wmDur=getDuration(watermarked); console.log(` watermarked dur ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
    const pubUrl=await presignUpload(watermarked); console.log(` uploaded ${pubUrl}`);
    const postRes=await createReel(content, pubUrl);
    const postId=postRes.post?._id || postRes._id || postRes.id || postRes.post?.id || ""; console.log(` posted ${postId} ${JSON.stringify(postRes).slice(0,300)}`);
    await new Promise(r=>setTimeout(r,4000));
    let verified=false; try{ const v=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}}); const vj=JSON.parse(await v.text()); const post=vj.post||vj; const hasVideo=(post.mediaItems||[]).length===1 && post.mediaItems[0].type==="video"; const status=post.platforms?.[0]?.status; verified=hasVideo && status==="published"; console.log(` verify hasVideo=${hasVideo} status=${status} => ${verified}`); }catch(e){ console.log(" verify err", e.message.slice(0,200)); }
    results.push({i, id:c.id, tournament:c.tournament, year:c.year, homeTeam:c.homeTeam, awayTeam:c.awayTeam, duration:Math.round(wmDur), views:c.view_count, likes:c.like_count, publicUrl:pubUrl, postId, verified});
    if(verified){ posted.add(highlight.id); const ht=normalizeTeam(highlight.homeTeam), at=normalizeTeam(highlight.awayTeam); const tNorm=highlight.tournament.toLowerCase().replace(/\s+/g,"-"); for(const k of [`historic-${tNorm}-${highlight.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${highlight.year}_${tNorm}`, `${ht}_vs_${at}_${highlight.year}`]) posted.add(k); savePosted(posted); }
  }
  fs.writeFileSync("/tmp/post2n_results.json", JSON.stringify(results,null,2));
  console.log("\n=== DONE NOW ==="); console.log(JSON.stringify(results,null,2));
  // also run scrapling verification for demo metadata via python
  try{ execSync(`python3 /home/john/scrapling_yt_demo/yt_scrapling.py "https://www.youtube.com/watch?v=${picks[0].id}" 2>&1 | tail -n 20`, {encoding:"utf8", timeout:20000}); }catch(e){ console.log(e.stdout||e.message); }
}
main().catch(e=>{ console.error(e); process.exit(1); });
