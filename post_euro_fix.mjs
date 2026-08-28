import fs from "fs"; import path from "path"; import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js"; import { getDiverseBatch } from "./src/historical.js";
import { formatPost } from "./src/formatter.js"; import { applyDynamicWatermark } from "./src/watermark.js";
import { isCartoonVideoSync, isCartoonVideo } from "./src/cartoonFilter.js"; import { validateHighlight, isFifaHighRisk } from "./src/validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";
function ensureProfilePic(){const p="/tmp/page_profile.jpg";if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p; try{const url="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";execSync(`curl -s -L "${url}" -o "${p}"`,{timeout:15000});if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p;}catch{} try{execSync(`/usr/bin/ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);}catch{} return p;}
async function presignUpload(f){const fn=path.basename(f);const sz=fs.statSync(f).size;const body={filename:fn,contentType:"video/mp4",size:sz};const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const t=await r.text();if(!r.ok) throw new Error(`presign ${r.status} ${t.slice(0,500)}`);const j=JSON.parse(t);const up=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl;const pub=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;if(!up) throw new Error("no uploadUrl "+t.slice(0,500));const finalPub=pub||up.split("?")[0];const buf=fs.readFileSync(f);const put=await fetch(up,{method:"PUT",body:buf,headers:{"Content-Type":"video/mp4"}});if(!put.ok) throw new Error(`PUT ${put.status} ${await put.text().then(s=>s.slice(0,300))}`);return finalPub;}
async function createReelPost(content,mediaUrl){const pls=[{content,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaItems:[{type:"video",url:mediaUrl}]},{content,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaUrls:[mediaUrl]}];let e;for(const b of pls){const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(b)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}} if(r.ok) return j; e=new Error(`${r.status} ${JSON.stringify(j).slice(0,600)}`); if(r.status===400) continue; throw e;} throw e;}
function getDuration(p){try{const o=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim();const d=parseFloat(o);if(!isNaN(d)) return d;}catch{} return null;}
function dl(url,out){let info=null;try{const j=execSync(`yt-dlp --dump-json --no-playlist "${url}" 2>/dev/null | head -n 1`,{encoding:"utf8",timeout:15000}).trim();if(j) info=JSON.parse(j);}catch{} const cmd=`yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`;console.log(cmd);try{execSync(cmd,{stdio:"inherit",timeout:180000})}catch(e){if(!fs.existsSync(out)) throw e} if(!fs.existsSync(out)) throw new Error("dl fail "+out); return info;}
function ytsearch5(q){try{const o=execSync(`yt-dlp "ytsearch5:${q}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:25000,encoding:"utf8"}).trim();const lines=o.split("\n").filter(Boolean);const c=[];for(let i=0;i<lines.length-1;i+=2){const t=lines[i];const id=lines[i+1];if(/^[A-Za-z0-9_-]{6,}$/.test(id)) c.push({id,title:t,thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`})} if(!c.length){const ids=o.split("\n").map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{6,}$/.test(s));for(const id of ids) c.push({id,title:"",thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`})} return c;}catch{return []}}
const profilePic=ensureProfilePic();console.log("profile",profilePic);
const existingIds = new Set(["6a87cfa729c268c232332165","6a87cf18dee05547ad01c88e","6a87ce8e1bf50846a2944eff","6a87ce2327b2e7c093e26d05","6a87cddb3c21261e943d4a33"]);
const results=[];
const picks = [
  {tournament:"Euro",year:2004,match:{homeTeam:"Greece",awayTeam:"Portugal"},title:"Euro 2004 Final — Greece vs Portugal",query:"Euro 2004 Final Greece vs Portugal highlights"},
  {tournament:"Premier League",year:2019,match:{homeTeam:"Liverpool",awayTeam:"Man City"},title:"Premier League 2019 — Liverpool vs Man City",query:"Premier League 2019 Liverpool vs Man City highlights"},
  {tournament:"Bundesliga",year:2013,match:{homeTeam:"Bayern Munich",awayTeam:"Dortmund"},title:"Bundesliga 2013 — Bayern Munich vs Dortmund",query:"Bundesliga 2013 Bayern Munich vs Dortmund highlights"},
  {tournament:"Champions League",year:2022,match:{homeTeam:"Real Madrid",awayTeam:"Liverpool"},title:"UCL 2022 Final — Real Madrid vs Liverpool",query:"Real Madrid vs Liverpool Champions League 2022 Final highlights"},
  {tournament:"La Liga",year:2017,match:{homeTeam:"Real Madrid",awayTeam:"Barcelona"},title:"La Liga 2017 — Real Madrid vs Barcelona",query:"Real Madrid vs Barcelona La Liga 2017 highlights"},
];
let idx=0;
for(const pick of picks){
  idx++; console.log(`\n=== pick ${idx}/5: ${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam} query=${pick.query} ===`);
  const cands=ytsearch5(pick.query); console.log(` cands ${cands.length}`);
  let done=false;
  for(let ci=0;ci<cands.length;ci++){
    const c=cands[ci]; console.log(`  ${ci+1}: ${c.id} ${c.title.slice(0,90)}`);
    if(isCartoonVideoSync(c.title,"")){console.log("   skip cartoon");continue}
    try{if(await isCartoonVideo(c.title,"",c.thumbnail)){console.log("   skip cartoon vision");continue}}catch{}
    const fifa=isFifaHighRisk({title:c.title,description:c.title,league:`${pick.tournament} ${pick.year}`,uploader:""}); if(fifa.risk){console.log("   skip fifa "+fifa.reason);continue}
    const parsed=parseHighlightFromTitle(c.title,{fallbackYear:pick.year,fallbackTournament:pick.tournament});
    if(!parsed.homeTeam||!parsed.awayTeam){console.log(`   skip parse ${parsed.homeTeam}/${parsed.awayTeam}`);continue}
    console.log(`   parsed ${parsed.homeTeam} vs ${parsed.awayTeam} ${parsed.tournament} ${parsed.year} ${parsed.stage}`);
    const highlight={id:`eurofix-${c.id}`,title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,league:`${parsed.tournament} ${parsed.year}`,homeTeam:parsed.homeTeam,awayTeam:parsed.awayTeam,tournament:parsed.tournament,year:parsed.year,date:`${parsed.year}-07-01`,stage:parsed.stage,ytTitle:c.title,candidateTitle:c.title,videoUrl:`https://www.youtube.com/watch?v=${c.id}`,thumbnail:c.thumbnail};
    const content=formatPost(highlight);
    if(/youtube\.com|youtu\.be/i.test(content)){console.log("   skip yt link");continue}
    const wt={tournamentYear:`${parsed.tournament} ${parsed.year}`,matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`,stage:parsed.stage};
    const triple=validateTripleMatch(parsed,c.title,content,wt); if(!triple.ok){console.log("   skip triple "+triple.reason);continue}
    let logoPath; try{logoPath=requireTournamentLogo(parsed.tournament,parsed.year)}catch(e){console.log("   skip logo "+e.message);continue}
    if(!fs.existsSync(logoPath)){console.log("   logo missing");continue}
    const buf=fs.readFileSync(logoPath); if(!(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf.length>=500)){console.log("   invalid png");continue}
    const raw=`/tmp/raw_eurofix_${idx}_${ci}.mp4`;
    try{dl(highlight.videoUrl,raw)}catch(e){console.log("   dl fail "+e.message.slice(0,100));continue}
    const dur=getDuration(raw); console.log(`   dur ${dur?.toFixed(1)}`);
    if(dur===null||dur<60||dur>250){console.log("   skip dur "+dur);try{fs.unlinkSync(raw)}catch{};continue}
    const v=await validateHighlight({...highlight,title:c.title,candidateTitle:c.title,ytTitle:c.title},{localVideoPath:raw,skipVision:true,candidateTitle:c.title}); if(!v.valid){console.log("   validate fail "+v.reason);try{fs.unlinkSync(raw)}catch{};continue}
    const wm=`/tmp/wm_eurofix_${idx}.mp4`;
    console.log(`   watermark HIGH UP 110 left ${logoPath}`);
    applyDynamicWatermark(raw,{tournament:parsed.tournament,year:parsed.year,teamA:parsed.homeTeam,teamB:parsed.awayTeam,stage:parsed.stage,logoPath,watermarkPath:profilePic,output:wm,headerHeight:110,logoScaleH:100,logoPos:"left",watermarkPos:"top-right",watermarkSize:140,watermarkAlpha:0.6,crf:30,autoDetect:false,skipTitleBar:false});
    const wmd=getDuration(wm); console.log(`   wmd ${wmd?.toFixed(1)} size ${Math.round(fs.statSync(wm).size/1024/1024)}MB`);
    const pub=await presignUpload(wm); console.log(`   pub ${pub}`);
    const postRes=await createReelPost(content,pub); console.log(`   post ${JSON.stringify(postRes).slice(0,500)}`);
    const postId=postRes.post?._id||postRes._id||postRes.id||postRes.data?._id||"";
    await new Promise(r=>setTimeout(r,3000));
    try{const vr=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});const vj=JSON.parse(await vr.text());const p=vj.post||vj;console.log(`   verify mediaItems=${p.mediaItems?.length} type=${p.mediaItems?.[0]?.type} status=${p.platforms?.[0]?.status}`)}catch{}
    results.push({highlight,content,ytTitle:c.title,pub,postId,dur:Math.round(dur),wmd,logo:logoPath});
    try{fs.unlinkSync(raw)}catch{}; done=true; break;
  }
  if(!done) console.log("  NO valid candidate for pick "+pick.query);
}
console.log("\n=== VERIFY 5 ===");
for(const r of results){
  try{const res=await fetch(`${config.zernioBaseUrl}/posts/${r.postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});const j=JSON.parse(await res.text());const p=j.post||j;const mi=p.mediaItems||[];const plat=p.platforms?.[0];const okMedia=mi.length===1&&mi[0].type==="video";const okPub=plat?.status==="published"||plat?.status==="publishing";const okTeams=p.content?.toLowerCase().includes(r.highlight.homeTeam.toLowerCase().split(" ")[0])&&p.content?.toLowerCase().includes(r.highlight.awayTeam.toLowerCase().split(" ")[0]);console.log(`${r.postId} ${r.highlight.tournament} ${r.highlight.year} ${r.highlight.homeTeam} vs ${r.highlight.awayTeam} media=${okMedia} pub=${okPub} teams=${okTeams} verified=${okMedia&&okPub&&okTeams}`)}catch(e){console.log(e.message)}
}
fs.writeFileSync("/tmp/post10_final_results.json",JSON.stringify(results,null,2));
console.log(`DONE ${results.length}/5`);
console.log(JSON.stringify(results.map(r=>({postId:r.postId,teams:`${r.highlight.homeTeam} vs ${r.highlight.awayTeam}`,tournament:r.highlight.tournament,year:r.highlight.year,ytTitle:r.ytTitle,dur:r.dur,logo:r.logo})),null,2));
