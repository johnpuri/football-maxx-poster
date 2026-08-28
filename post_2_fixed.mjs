import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { applyDynamicWatermark } from "./src/watermark.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";

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
function downloadYt(id, out){
  console.log(`downloading ${id} -> ${out}`);
  execSync(`yt-dlp --cookies-from-browser chrome -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist -o "${out}" "https://www.youtube.com/watch?v=${id}" 2>&1 | tail -n 5`, {timeout:180000, encoding:"utf8"});
}
function trimToRange(inp, out, target=150){
  execSync(`ffmpeg -y -ss 0 -t ${target} -i "${inp}" -c copy "${out}" 2>/dev/null || ffmpeg -y -ss 0 -t ${target} -i "${inp}" -c:v libx264 -c:a aac "${out}" 2>/dev/null`, {timeout:60000});
  return out;
}
function loadPosted(){
  const set=new Set();
  for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ for(const k of JSON.parse(fs.readFileSync(p,"utf8"))) set.add(k);}catch{}
  return set;
}
function savePosted(set){
  const arr=[...set].sort();
  for(const p of ["./posted.json","./src/posted.json","/tmp/posted_set.json"]) try{ fs.writeFileSync(p, JSON.stringify(arr,null,2));}catch{}
}
function normalizeTeam(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function isPostedCandidate(c, posted){
  const ht=normalizeTeam(c.homeTeam), at=normalizeTeam(c.awayTeam);
  const tNorm=c.tournament.toLowerCase().replace(/\s+/g,"-");
  const keys=[`historic-${tNorm}-${c.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${c.year}_${tNorm}`, `${ht}_vs_${at}_${c.year}`];
  return keys.some(k=> posted.has(k));
}
function ytSearchHighLikes(query, count=5){
  try{
    const out=execSync(`yt-dlp --cookies-from-browser chrome "ytsearch${count}:${query}" --dump-json --no-warnings 2>/dev/null`, {timeout:40000, encoding:"utf8", maxBuffer:15*1024*1024}).trim();
    const cands=[];
    for(const line of out.split("\n").filter(Boolean)){
      if(!line.trim().startsWith("{")) continue;
      try{
        const j=JSON.parse(line);
        if(!j.id) continue;
        cands.push({id:j.id, title:j.title||"", view_count:j.view_count||0, like_count:j.like_count||0, duration:j.duration||0, uploader:j.uploader||""});
      }catch{}
    }
    // Scrapling-style filtering: high likes, native 90-210s
    const filtered=cands.filter(c=> (c.view_count>=10000) && (c.view_count>50000 || c.like_count>1000) && c.duration>=90 && c.duration<=210 && !/cartoon|animation|pes|efootball|simulation/i.test(c.title) && !/fifa world cup final/i.test(c.title) );
    filtered.sort((a,b)=> (b.view_count||0)-(a.view_count||0) || (b.like_count||0)-(a.like_count||0));
    const pool = filtered.length? filtered : cands.filter(c=>c.duration>=90 && c.duration<=210 && c.view_count>=5000);
    pool.sort((a,b)=> (b.view_count||0)-(a.view_count||0));
    console.log(`[ytSearch] "${query}" ${cands.length} cands -> ${filtered.length} high-like -> pool ${pool.length} top=${pool[0]?.id} views=${pool[0]?.view_count} likes=${pool[0]?.like_count} dur=${pool[0]?.duration}`);
    return pool.length? pool : cands;
  }catch(e){ console.log(`[ytSearch] fail ${query}: ${e.message.slice(0,200)}`); return []; }
}

// Diverse candidates not in posted - safe leagues only (copyright filtered: no WC final, no FIFA.tv)
const allCandidates=[
  { tournament:"Premier League", year:2023, homeTeam:"Arsenal", awayTeam:"Liverpool", stage:"Regular Season", query:"Arsenal vs Liverpool Premier League 2023 Highlights" },
  { tournament:"Serie A", year:2010, homeTeam:"Inter Milan", awayTeam:"AC Milan", stage:"Regular Season", query:"Inter Milan AC Milan Serie A 2010 Highlights" },
  { tournament:"Ligue 1", year:2018, homeTeam:"PSG", awayTeam:"Marseille", stage:"Regular Season", query:"PSG vs Marseille Ligue 1 2018 Highlights" },
  { tournament:"Bundesliga", year:2019, homeTeam:"Bayern Munich", awayTeam:"Dortmund", stage:"Regular Season", query:"Bayern Munich vs Dortmund Bundesliga 2019 Highlights" },
  { tournament:"Europa League", year:2016, homeTeam:"Liverpool", awayTeam:"Sevilla", stage:"Final", query:"Liverpool vs Sevilla Europa League 2016 Final Highlights" },
  { tournament:"La Liga", year:2017, homeTeam:"Real Madrid", awayTeam:"Barcelona", stage:"Regular Season", query:"Real Madrid vs Barcelona La Liga 2017 Highlights" },
];

async function main(){
  console.log("=== POST 2 FIXED: Scrapling metadata high likes, native 2-3min, no duplicate, bar HIGH UP, watermark, triple-match, copyright filtered, verify ===");
  const posted=loadPosted();
  console.log(`posted size ${posted.size}`);
  const filtered=allCandidates.filter(c=> !isPostedCandidate(c, posted));
  console.log(`filtered ${filtered.length} not posted:`, filtered.map(c=>`${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam}`));
  // For each filtered, get high-likes candidate via ytSearch
  const picks=[];
  for(const c of filtered){
    const cands=ytSearchHighLikes(c.query, 10);
    if(!cands.length) continue;
    // pick top that is not cartoon/copyright and passes duration
    for(const cand of cands){
      // Scrapling metadata already filtered, verify via extra check
      if(cand.duration<90 || cand.duration>210){ console.log(` skip ${cand.id} dur ${cand.duration} out of 90-210`); continue; }
      if(/world cup.*final/i.test(cand.title) && /fifa/i.test(cand.title)){ console.log(` skip FIFA WC final ${cand.id}`); continue; }
      picks.push({...c, id:cand.id, ytTitle:cand.title, view_count:cand.view_count, like_count:cand.like_count, duration:cand.duration, uploader:cand.uploader});
      console.log(` pick ${c.tournament} ${c.year} => ${cand.id} views=${cand.view_count} likes=${cand.like_count} dur=${cand.duration} title=${cand.title.slice(0,60)}`);
      break;
    }
    if(picks.length>=2) break;
  }
  console.log(`\nFinal picks:`, picks.slice(0,2).map(p=>`${p.id} ${p.tournament} ${p.homeTeam} vs ${p.awayTeam} views=${p.view_count} likes=${p.like_count} dur=${p.duration}`));
  if(picks.length<2){ console.error("Not enough valid picks"); process.exit(1); }

  const profilePic=ensureProfilePic();
  const results=[];
  for(let i=0;i<2;i++){
    const c=picks[i];
    console.log(`\n--- [${i}] ${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} id=${c.id} ---`);
    const raw=`/tmp/post2f_raw_${i}_${c.id}.mp4`;
    const trimmed=`/tmp/post2f_trim_${i}.mp4`;
    const watermarked=`/tmp/post2f_wm_${i}.mp4`;
    if(!fs.existsSync(raw) || fs.statSync(raw).size<10000){
      try{ downloadYt(c.id, raw); }catch(e){ console.log("download fail", e.message.slice(0,500)); continue; }
    }
    if(!fs.existsSync(raw)){ console.log("no raw"); continue; }
    let dur=getDuration(raw);
    console.log(` raw dur ${dur?.toFixed(1)}s size ${Math.round(fs.statSync(raw).size/1024/1024)}MB`);
    if(!dur || dur<10){ console.log("bad dur"); continue; }
    let srcForWm=raw;
    if(dur>210){
      console.log(` trimming ${dur.toFixed(1)} -> 150s`);
      trimToRange(raw, trimmed, 150);
      srcForWm=trimmed;
      dur=getDuration(srcForWm);
      console.log(` trimmed dur ${dur?.toFixed(1)}s`);
    }
    if(dur<90 || dur>210){ console.log(` still out of range ${dur}, skip`); continue; }
    if(/cartoon|animation|animated|442oons|pes|efootball|simulation|simulated|lego|minecraft/i.test(c.ytTitle)){ console.log(" cartoon skip"); continue; }
    if(/fifa world cup final/i.test(c.ytTitle)){ console.log(" copyright FIFA WC final skip"); continue; }
    let parsed = parseHighlightFromTitle(c.ytTitle, {fallbackYear:c.year, fallbackTournament:c.tournament});
    parsed.homeTeam=c.homeTeam; parsed.awayTeam=c.awayTeam; parsed.tournament=c.tournament; parsed.year=c.year; parsed.stage=c.stage;
    console.log(` parsed ${parsed.tournament} ${parsed.year} ${parsed.homeTeam} vs ${parsed.awayTeam}`);
    const highlight={ id:`post2-${c.tournament.toLowerCase().replace(/\s+/g,"-")}-${c.year}-${c.homeTeam.toLowerCase().replace(/\s+/g,"-")}-vs-${c.awayTeam.toLowerCase().replace(/\s+/g,"-")}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, homeTeam:parsed.homeTeam, awayTeam:parsed.awayTeam, tournament:parsed.tournament, year:parsed.year, date:`${parsed.year}-07-01`, stage:parsed.stage, ytTitle:c.ytTitle, candidateTitle:c.ytTitle, videoUrl:`https://www.youtube.com/watch?v=${c.id}`, thumbnail:`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`, source:"yt-dlp-post2-fixed", ytId:c.id };
    const content=formatPost(highlight);
    if(/youtube\.com|youtu\.be/i.test(content)){ console.log(" youtube link in content skip"); continue; }
    const watermarkTexts={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage };
    const triple=validateTripleMatch(parsed, c.ytTitle, content, watermarkTexts);
    console.log(` triple ${triple.ok? "OK": "FAIL "+triple.reason}`);
    if(!triple.ok) continue;
    let logoPath; try{ logoPath=requireTournamentLogo(parsed.tournament, parsed.year); }catch(e){ console.log("logo fail",e.message); continue; }
    console.log(` logo ${path.basename(logoPath)} HIGH UP 110px`);
    try{
      applyDynamicWatermark(srcForWm, { tournament:parsed.tournament, year:parsed.year, teamA:parsed.homeTeam, teamB:parsed.awayTeam, stage:parsed.stage, logoPath, watermarkPath:profilePic, output:watermarked, headerHeight:110, logoScaleH:100, logoPos:"left", watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6, crf:30, autoDetect:false });
    }catch(e){ console.log("watermark fail", e.message.slice(0,500)); continue; }
    const wmDur=getDuration(watermarked);
    console.log(` watermarked dur ${wmDur?.toFixed(1)}s size ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
    if(!wmDur || wmDur<90 || wmDur>210){ console.log(" wm dur out of range"); continue; }
    const pubUrl=await presignUpload(watermarked);
    console.log(` uploaded ${pubUrl}`);
    if(!pubUrl.startsWith("https://media.zernio.com")) throw new Error("not media.zernio.com");
    const postRes=await createReel(content, pubUrl);
    const postId=postRes.post?._id || postRes._id || postRes.id || postRes.post?.id || "";
    console.log(` posted ${postId}`);
    await new Promise(r=>setTimeout(r,4000));
    let verified=false;
    try{
      const v=await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
      const vj=JSON.parse(await v.text()); const post=vj.post||vj;
      const hasVideo=(post.mediaItems||[]).length===1 && post.mediaItems[0].type==="video";
      const status=post.platforms?.[0]?.status;
      verified=hasVideo && status==="published";
      console.log(` verify hasVideo=${hasVideo} status=${status} => ${verified} contentLen=${(post.content||"").length} media0=${post.mediaItems?.[0]?.url?.slice(0,40)}`);
    }catch(e){ console.log(" verify err", e.message.slice(0,200)); }
    results.push({i, id:c.id, tournament:c.tournament, year:c.year, homeTeam:c.homeTeam, awayTeam:c.awayTeam, duration:Math.round(wmDur), views:c.view_count, likes:c.like_count, publicUrl:pubUrl, postId, verified, content:content.slice(0,100)});
    if(verified){
      posted.add(highlight.id);
      const ht=normalizeTeam(highlight.homeTeam), at=normalizeTeam(highlight.awayTeam);
      const tNorm=highlight.tournament.toLowerCase().replace(/\s+/g,"-");
      for(const k of [`historic-${tNorm}-${highlight.year}-${ht}-vs-${at}`, `${ht}_vs_${at}_${highlight.year}_${tNorm}`, `${ht}_vs_${at}_${highlight.year}`]) posted.add(k);
      savePosted(posted);
    }
    await new Promise(r=>setTimeout(r,2000));
  }
  fs.writeFileSync("/tmp/post2f_results.json", JSON.stringify(results,null,2));
  console.log("\n=== DONE FIXED ===");
  console.log(JSON.stringify(results,null,2));
  if(results.filter(r=>r.verified).length<2) process.exit(1);
}
main().catch(e=>{ console.error(e); process.exit(1); });
