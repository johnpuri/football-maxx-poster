import fs from "fs"; import path from "path"; import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js"; import { applyDynamicWatermark } from "./src/watermark.js";
import { isCartoonVideoSync, isCartoonVideo } from "./src/cartoonFilter.js"; import { validateHighlight, isFifaHighRisk } from "./src/validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";
function ensureProfilePic(){const p="/tmp/page_profile.jpg";if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p; try{const u="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";execSync(`curl -s -L "${u}" -o "${p}"`,{timeout:15000});if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p;}catch{} try{execSync(`/usr/bin/ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);}catch{} return p;}
async function presignUpload(f){const fn=path.basename(f);const sz=fs.statSync(f).size;const body={filename:fn,contentType:"video/mp4",size:sz};const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const t=await r.text();if(!r.ok) throw new Error(t.slice(0,500));const j=JSON.parse(t);const up=j.uploadUrl||j.url||j.data?.uploadUrl;const pub=j.publicUrl||j.publicURL||j.fileUrl||up.split("?")[0];const buf=fs.readFileSync(f);const put=await fetch(up,{method:"PUT",body:buf,headers:{"Content-Type":"video/mp4"}});if(!put.ok) throw new Error(await put.text());return pub||up.split("?")[0];}
async function createReelPost(c,m){const pls=[{content:c,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaItems:[{type:"video",url:m}]},{content:c,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaUrls:[m]}];let e;for(const b of pls){const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(b)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}} if(r.ok) return j; e=new Error(JSON.stringify(j).slice(0,500))} throw e;}
function getDur(p){try{const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim();const d=parseFloat(o);if(!isNaN(d)) return d;}catch{} return null;}
function dl(url,out){const cmd=`yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`;console.log(cmd);execSync(cmd,{stdio:"inherit",timeout:180000}); if(!fs.existsSync(out)) throw new Error("dl fail")}
function ytsearch5(q){try{const o=execSync(`yt-dlp "ytsearch5:${q}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:25000,encoding:"utf8"}).trim();const ls=o.split("\n").filter(Boolean);const c=[];for(let i=0;i<ls.length-1;i+=2){const t=ls[i];const id=ls[i+1];if(/^[A-Za-z0-9_-]{6,}$/.test(id)) c.push({id,title:t,thumb:`https://img.youtube.com/vi/${id}/hqdefault.jpg`})} return c;}catch{return []}}
const pp=ensureProfilePic();
const picks=[
 {tournament:"Premier League",year:2012,query:"Manchester City vs Manchester United Premier League 2012 highlights",match:{homeTeam:"Man City",awayTeam:"Man United"}},
 {tournament:"Serie A",year:2020,query:"Juventus vs Inter Milan Serie A 2020 highlights",match:{homeTeam:"Juventus",awayTeam:"Inter Milan"}},
 {tournament:"Europa League",year:2023,query:"Sevilla vs Roma Europa League 2023 Final highlights",match:{homeTeam:"Sevilla",awayTeam:"Roma"}},
 {tournament:"Bundesliga",year:2019,query:"Bayern Munich vs Dortmund Bundesliga 2019 highlights",match:{homeTeam:"Bayern Munich",awayTeam:"Dortmund"}},
 {tournament:"FA Cup",year:2022,query:"Liverpool vs Chelsea FA Cup 2022 Final highlights",match:{homeTeam:"Liverpool",awayTeam:"Chelsea"}},
];
const results=[];
for(let idx=0;idx<picks.length && results.length<3;idx++){
 const pick=picks[idx]; console.log(`\n=== pick ${pick.tournament} ${pick.year} query=${pick.query}`);
 const cands=ytsearch5(pick.query); console.log(` cands ${cands.length}`);
 for(let ci=0;ci<cands.length && results.length<3;ci++){
  const c=cands[ci]; console.log(`  ${ci+1} ${c.id} ${c.title.slice(0,90)}`);
  if(isCartoonVideoSync(c.title,"")){console.log("   cartoon");continue}
  try{if(await isCartoonVideo(c.title,"",c.thumb)){console.log("   cartoon vision");continue}}catch{}
  if(isFifaHighRisk({title:c.title,description:c.title,league:`${pick.tournament} ${pick.year}`,uploader:""}).risk){console.log("   fifa");continue}
  const parsed=parseHighlightFromTitle(c.title,{fallbackYear:pick.year,fallbackTournament:pick.tournament});
  if(!parsed.homeTeam||!parsed.awayTeam){console.log(`   parse fail ${parsed.homeTeam}/${parsed.awayTeam}`);continue}
  const hl={id:`f3-${c.id}`,title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,league:`${parsed.tournament} ${parsed.year}`,homeTeam:parsed.homeTeam,awayTeam:parsed.awayTeam,tournament:parsed.tournament,year:parsed.year,date:`${parsed.year}-07-01`,stage:parsed.stage,ytTitle:c.title,videoUrl:`https://www.youtube.com/watch?v=${c.id}`,thumbnail:c.thumb};
  const content=formatPost(hl); if(/youtube/i.test(content)){console.log("   ytlink");continue}
  const triple=validateTripleMatch(parsed,c.title,content,{tournamentYear:`${parsed.tournament} ${parsed.year}`,matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`,stage:parsed.stage}); if(!triple.ok){console.log("   triple "+triple.reason);continue}
  let logo; try{logo=requireTournamentLogo(parsed.tournament,parsed.year)}catch(e){console.log("   logo "+e.message);continue}
  const buf=fs.readFileSync(logo); if(!(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47)){console.log("   bad png");continue}
  const raw=`/tmp/raw_f3_${results.length}_${ci}.mp4`; try{dl(hl.videoUrl,raw)}catch(e){console.log("   dl fail");continue}
  const dur=getDur(raw); console.log(`   dur ${dur}`); if(dur===null||dur<60||dur>250){console.log("   dur skip");try{fs.unlinkSync(raw)}catch{};continue}
  const v=await validateHighlight({...hl,title:c.title,candidateTitle:c.title,ytTitle:c.title},{localVideoPath:raw,skipVision:true,candidateTitle:c.title}); if(!v.valid){console.log("   validate "+v.reason);try{fs.unlinkSync(raw)}catch{};continue}
  const wm=`/tmp/wm_f3_${results.length}.mp4`; applyDynamicWatermark(raw,{tournament:parsed.tournament,year:parsed.year,teamA:parsed.homeTeam,teamB:parsed.awayTeam,stage:parsed.stage,logoPath:logo,watermarkPath:pp,output:wm,headerHeight:110,logoScaleH:100,logoPos:"left",watermarkPos:"top-right",watermarkSize:140,watermarkAlpha:0.6,crf:30,skipTitleBar:false});
  const wmd=getDur(wm); console.log(`   wm ${wmd} ${Math.round(fs.statSync(wm).size/1e6)}MB`);
  const pub=await presignUpload(wm); console.log(`   pub ${pub}`);
  const pr=await createReelPost(content,pub); console.log(`   post ${JSON.stringify(pr).slice(0,400)}`);
  const pid=pr.post?._id||pr._id||pr.id; await new Promise(r=>setTimeout(r,3000));
  try{const vr=await fetch(`${config.zernioBaseUrl}/posts/${pid}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});const j=JSON.parse(await vr.text());console.log(`   verify ${j.post?.mediaItems?.length} ${j.post?.platforms?.[0]?.status}`)}catch{}
  results.push({hl,content,ytTitle:c.title,pub,pid,dur,logo}); try{fs.unlinkSync(raw)}catch{}; break;
 }
}
console.log(`\nDONE ${results.length}/3`);
for(const r of results) console.log(`${r.pid} ${r.hl.tournament} ${r.hl.year} ${r.hl.homeTeam} vs ${r.hl.awayTeam} dur=${r.dur}`);
fs.writeFileSync("/tmp/f3_results.json",JSON.stringify(results,null,2));
