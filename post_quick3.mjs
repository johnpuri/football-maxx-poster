import fs from "fs"; import path from "path"; import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js"; import { applyDynamicWatermark } from "./src/watermark.js";
import { isCartoonVideoSync, isCartoonVideo } from "./src/cartoonFilter.js"; import { validateHighlight, isFifaHighRisk } from "./src/validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";
function ppic(){const p="/tmp/page_profile.jpg"; if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p; return p;}
async function presign(f){const fn=path.basename(f); const sz=fs.statSync(f).size; const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({filename:fn,contentType:"video/mp4",size:sz})}); const t=await r.text(); if(!r.ok) throw new Error(t.slice(0,400)); const j=JSON.parse(t); const up=j.uploadUrl||j.url; const pub=j.publicUrl||up.split("?")[0]; const buf=fs.readFileSync(f); const put=await fetch(up,{method:"PUT",body:buf,headers:{"Content-Type":"video/mp4"}}); if(!put.ok) throw new Error(await put.text()); return pub||up.split("?")[0];}
async function createPost(c,m){const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({content:c,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaItems:[{type:"video",url:m}]})}); const t=await r.text(); if(!r.ok) throw new Error(t.slice(0,500)); return JSON.parse(t);}
function dur(p){try{const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim(); return parseFloat(o);}catch{return null}}
function dl(url,out){try{fs.unlinkSync(out)}catch{}; const cmd=`yt-dlp --no-playlist -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`; console.log(cmd); execSync(cmd,{stdio:"inherit",timeout:180000});}
function search(q){try{const o=execSync(`yt-dlp "ytsearch5:${q}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:25000,encoding:"utf8"}).trim(); const ls=o.split("\n").filter(Boolean); const c=[]; for(let i=0;i<ls.length-1;i+=2){const t=ls[i]; const id=ls[i+1]; if(/^[A-Za-z0-9_-]{6,}$/.test(id)) c.push({id,title:t})} return c;}catch{return []}}
const pp=ppic();
const picks=[
 {t:"La Liga",y:2010,q:"Barcelona vs Real Madrid 5-0 La Liga 2010 highlights"},
 {t:"Premier League",y:2023,q:"Arsenal vs Liverpool Premier League 2023 highlights"},
 {t:"Serie A",y:2010,q:"Inter Milan vs AC Milan Serie A 2010 highlights"},
];
const res=[];
for(let pi=0; pi<picks.length && res.length<3; pi++){
 const pick=picks[pi]; console.log(`\n=== ${pick.t} ${pick.y} ${pick.q}`);
 const cands=search(pick.q); console.log(` cands ${cands.length}`);
 for(let ci=0; ci<cands.length && res.length<3; ci++){
  const c=cands[ci]; console.log(` ${ci+1} ${c.id} ${c.title.slice(0,90)}`);
  if(isCartoonVideoSync(c.title,"")){console.log("  cartoon"); continue}
  try{if(await isCartoonVideo(c.title,"",`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`)){console.log("  cartoon2"); continue}}catch{}
  if(isFifaHighRisk({title:c.title,description:c.title,league:`${pick.t} ${pick.y}`,uploader:""}).risk){console.log("  fifa"); continue}
  const parsed=parseHighlightFromTitle(c.title,{fallbackYear:pick.y,fallbackTournament:pick.t});
  if(!parsed.homeTeam||!parsed.awayTeam){console.log(`  parse fail ${parsed.homeTeam}/${parsed.awayTeam}`); continue}
  console.log(`  parsed ${parsed.homeTeam} vs ${parsed.awayTeam}`);
  const hl={title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,league:`${parsed.tournament} ${parsed.year}`,homeTeam:parsed.homeTeam,awayTeam:parsed.awayTeam,tournament:parsed.tournament,year:parsed.year,date:`${parsed.year}-07-01`,stage:parsed.stage,ytTitle:c.title,videoUrl:`https://www.youtube.com/watch?v=${c.id}`};
  const content=formatPost(hl); if(/youtube/i.test(content)){console.log("  yt"); continue}
  if(!validateTripleMatch(parsed,c.title,content,{tournamentYear:`${parsed.tournament} ${parsed.year}`,matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`,stage:parsed.stage}).ok){console.log("  triple"); continue}
  let logo; try{logo=requireTournamentLogo(parsed.tournament,parsed.year)}catch(e){console.log("  logo "+e.message); continue}
  const raw=`/tmp/raw_q3_${res.length}_${ci}.mp4`; try{dl(hl.videoUrl,raw)}catch(e){console.log("  dl fail "+e.message.slice(0,80)); continue}
  const d=dur(raw); console.log(`  dur ${d}`); if(d===null||d<60||d>250){console.log("  dur skip"); try{fs.unlinkSync(raw)}catch{}; continue}
  const v=await validateHighlight({...hl,title:c.title,candidateTitle:c.title,ytTitle:c.title},{localVideoPath:raw,skipVision:true,candidateTitle:c.title}); if(!v.valid){console.log("  val "+v.reason); try{fs.unlinkSync(raw)}catch{}; continue}
  const wm=`/tmp/wm_q3_${res.length}.mp4`; applyDynamicWatermark(raw,{tournament:parsed.tournament,year:parsed.year,teamA:parsed.homeTeam,teamB:parsed.awayTeam,stage:parsed.stage,logoPath:logo,watermarkPath:pp,output:wm,headerHeight:110,logoScaleH:100,logoPos:"left",watermarkPos:"top-right",watermarkSize:140,watermarkAlpha:0.6,crf:30,skipTitleBar:false});
  const wmd=dur(wm); console.log(`  wm ${wmd}`);
  const pub=await presign(wm); console.log(`  pub ${pub}`);
  const pr=await createPost(content,pub); const pid=pr.post?._id||pr._id; console.log(`  post ${pid}`);
  await new Promise(r=>setTimeout(r,3000));
  try{const vr=await fetch(`${config.zernioBaseUrl}/posts/${pid}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}}); const j=JSON.parse(await vr.text()); console.log(`  verify ${j.post?.mediaItems?.length} ${j.post?.platforms?.[0]?.status}`);}catch{}
  res.push({hl,pid,ytTitle:c.title,dur:d,logo}); try{fs.unlinkSync(raw)}catch{}; break;
 }
}
console.log(`\nDONE ${res.length}/3`);
for(const r of res) console.log(`${r.pid} ${r.hl.tournament} ${r.hl.year} ${r.hl.homeTeam} vs ${r.hl.awayTeam}`);
fs.writeFileSync("/tmp/q3_results.json",JSON.stringify(res,null,2));
