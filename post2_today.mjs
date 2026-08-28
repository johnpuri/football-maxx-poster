import "dotenv/config"; import fs from "fs"; import path from "path"; import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js"; import { getDiverseBatch } from "./src/historical.js";
import { formatPost } from "./src/formatter.js"; import { applyDynamicWatermark } from "./src/watermark.js";
import { isCartoonVideoSync, isCartoonVideo } from "./src/cartoonFilter.js"; import { validateHighlight, isFifaHighRisk } from "./src/validate.js";
import { parseHighlightFromTitle, validateTripleMatch } from "./src/ytParser.js";
function ensureProfilePic(){const p="/tmp/page_profile.jpg";if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p; try{const url="https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-1/781679063_122103963255441254_4134931033144238495_n.jpg?stp=c191.191.1666.1666a_cp0_dst-jpg_s50x50_tt6&_nc_cat=102&ccb=1-7&_nc_sid=f907e8&_nc_ohc=PWxqsj6C9WIQ7kNvwFiyoHn&_nc_oc=AdpNAe9Af3dbtVsn2ww2q_vjwvX0Xpe7Kiu7UIudrkhUXKW7wT9A6djrNjweRzAPMNk&_nc_zt=24&_nc_ht=scontent-lhr6-1.xx&edm=AJdBtusEAAAA&_nc_gid=mNzGg2wOn11NE1NuRuCK9w&_nc_tpa=Q5bMBQKMDvxntj0h71a5IKh3WwJMd6r4FYjfVvBM_dx3AGyrFXRyoIqNgV5Lb5TZA4KvvX3VFvSeZV8t&oh=00_AQEp-GGsvkjlm0J_wq4ytYqGJH--Up3F8C6Qkphy4vf5Kg&oe=6A8C62EE";execSync(`curl -s -L "${url}" -o "${p}"`,{timeout:15000});if(fs.existsSync(p)&&fs.statSync(p).size>1000) return p;}catch{} try{execSync(`/usr/bin/ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`);}catch{} return p;}
async function presignUpload(filePath){const filename=path.basename(filePath);const size=fs.statSync(filePath).size;const body={filename,contentType:"video/mp4",size};const res=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST",headers:{Authorization: `Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const text=await res.text();if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,800)}`);const j=JSON.parse(text);const uploadUrl=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl;const publicUrl=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;if(!uploadUrl) throw new Error(`presign missing uploadUrl: ${text.slice(0,800)}`);const finalPublicUrl=publicUrl||uploadUrl.split('?')[0];const buf=fs.readFileSync(filePath);const put=await fetch(uploadUrl,{method:"PUT",body:buf,headers:{"Content-Type":"video/mp4"}});if(!put.ok) throw new Error(`upload PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);return finalPublicUrl;}
async function createReelPost(content,mediaUrl){const payloads=[{content,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaItems:[{type:"video",url:mediaUrl}]},{content,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaUrls:[mediaUrl]}];let lastErr;for(const body of payloads){const res=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST",headers:{Authorization: `Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const text=await res.text();let j;try{j=JSON.parse(text);}catch{j={raw:text}} if(res.ok) return j; lastErr=new Error(`createPost ${res.status}: ${JSON.stringify(j).slice(0,800)}`); if(res.status===400) continue; throw lastErr;} throw lastErr;}
function getDuration(p){try{const out=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim();const d=parseFloat(out);if(!isNaN(d)) return d;}catch{} return null;}
function downloadWithInfo(url,out){try{if(fs.existsSync(out)) fs.unlinkSync(out);}catch{}; const cmd=`yt-dlp --no-playlist -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best" --merge-output-format mp4 -o "${out}" "${url}"`; console.log(cmd); execSync(cmd,{stdio:"inherit",timeout:180000}); if(!fs.existsSync(out)) throw new Error(`download failed ${out}`);}
function getYtDurationSeconds(ytId){try{execSync(`yt-dlp --dump-json --no-playlist "https://www.youtube.com/watch?v=${ytId}" --no-warnings 2>/dev/null > /tmp/dump_${ytId}.json`,{timeout:15000});const j=JSON.parse(fs.readFileSync(`/tmp/dump_${ytId}.json`,"utf8"));return j.duration||null;}catch{return null;}}
function tryYtSearch5(query){try{const out=execSync(`yt-dlp "ytsearch5:${query}" --get-id --get-title --no-warnings 2>/dev/null | head -n 20`,{timeout:30000,encoding:"utf8"}).trim();const lines=out.split("\n").filter(Boolean);const cands=[];for(let i=0;i<lines.length-1;i+=2){const title=lines[i];const id=lines[i+1];if(/^[A-Za-z0-9_-]{6,}$/.test(id)) cands.push({id,title,thumbnail:`https://img.youtube.com/vi/${id}/hqdefault.jpg`});} return cands;}catch{return [];}}
const profilePic=ensureProfilePic(); console.log(`profilePic ${profilePic} ${fs.existsSync(profilePic)?fs.statSync(profilePic).size:0}`);
const results=[]; let attempts=0; const seen=new Set();
let queue=getDiverseBatch(10);
while(results.length<2 && attempts<60){
 attempts++;
 if(queue.length===0){ const batch=getDiverseBatch(8); for(const p of batch){const key=`${p.tournament}-${p.year}-${p.match.homeTeam}-${p.match.awayTeam}`; if(seen.has(key)||results.some(r=>r.highlight.tournament===p.tournament && r.highlight.year===p.year)) continue; if(/world cup/i.test(p.tournament) && /final/i.test(p.title)) continue; queue.push(p);} }
 const pick=queue.shift(); if(!pick) break;
 const key=`${pick.tournament}-${pick.year}-${pick.match.homeTeam}-${pick.match.awayTeam}`; if(seen.has(key)) continue;
 console.log(`\n--- pick ${results.length+1}/2: ${pick.tournament} ${pick.year} ${pick.match.homeTeam} vs ${pick.match.awayTeam} query=${pick.query} ---`);
 const cands=tryYtSearch5(pick.query); console.log(`  cands ${cands.length}`);
 let found=false;
 for(let ci=0;ci<cands.length;ci++){
  const c=cands[ci]; console.log(`  Candidate ${ci+1}: ${c.id} — ${c.title.slice(0,90)}`);
  if(isCartoonVideoSync(c.title,"")){console.log("    skip cartoon keyword");continue;}
  try{if(await isCartoonVideo(c.title,"",c.thumbnail)){console.log("    skip cartoon vision");continue;}}catch{}
  if(isFifaHighRisk({title:c.title,description:c.title,league:`${pick.tournament} ${pick.year}`,uploader:""}).risk){console.log("    skip FIFA");continue;}
  const parsed=parseHighlightFromTitle(c.title,{fallbackYear:pick.year,fallbackTournament:pick.tournament});
  if(!parsed.homeTeam||!parsed.awayTeam){console.log(`    skip parse fail`);continue;}
  const highlight={id:`today-${c.id}`,title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`,league:`${parsed.tournament} ${parsed.year}`,homeTeam:parsed.homeTeam,awayTeam:parsed.awayTeam,tournament:parsed.tournament,year:parsed.year,date:`${parsed.year}-07-01`,stage:parsed.stage,ytTitle:c.title,candidateTitle:c.title,videoUrl:`https://www.youtube.com/watch?v=${c.id}`,embedUrl:`https://www.youtube.com/watch?v=${c.id}`,thumbnail:c.thumbnail,source:"today",ytId:c.id};
  const content=formatPost(highlight);
  if(/youtube\.com|youtu\.be/i.test(content)){console.log("    skip yt link");continue;}
  const watermarkTexts={tournamentYear:`${parsed.tournament} ${parsed.year}`,matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`,stage:parsed.stage};
  const triple=validateTripleMatch(parsed,c.title,content,watermarkTexts); if(!triple.ok){console.log(`    skip triple ${triple.reason}`);continue;}
  let logoPath; try{logoPath=requireTournamentLogo(parsed.tournament,parsed.year);}catch(e){console.log(`    skip logo ${e.message}`);continue;}
  if(!fs.existsSync(logoPath)){console.log(`    skip logo missing`);continue;}
  const buf=fs.readFileSync(logoPath); if(!(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf.length>=500)){console.log("    skip invalid PNG");continue;}
  const nativeDur=getYtDurationSeconds(c.id); console.log(`    native duration ${nativeDur}s`); if(nativeDur===null||nativeDur<120||nativeDur>210){console.log(`    SKIP native not 120-210`);continue;}
  const raw=`/tmp/raw_today_${results.length}_${ci}.mp4`; try{downloadWithInfo(highlight.videoUrl,raw);}catch(e){console.log(`    download fail ${e.message.slice(0,120)}`);continue;}
  const dur=getDuration(raw); console.log(`    file duration ${dur?.toFixed(1)}s`); if(dur===null||dur<118||dur>215){console.log(`    skip file duration`);try{fs.unlinkSync(raw);}catch{};continue;}
  const v=await validateHighlight({...highlight,title:c.title,candidateTitle:c.title,ytTitle:c.title},{localVideoPath:raw,skipVision:true,candidateTitle:c.title}); if(!v.valid){console.log(`    validate fail ${v.reason}`);try{fs.unlinkSync(raw);}catch{};continue;}
  const watermarked=`/tmp/wm_today_${results.length}.mp4`;
  console.log(`    WATERMARK HIGH UP 110 left logo ${logoPath}`);
  applyDynamicWatermark(raw,{tournament:parsed.tournament,year:parsed.year,teamA:parsed.homeTeam,teamB:parsed.awayTeam,stage:parsed.stage,logoPath,watermarkPath:profilePic,output:watermarked,headerHeight:110,logoScaleH:100,logoPos:"left",watermarkPos:"top-right",watermarkSize:140,watermarkAlpha:0.6,crf:30,autoDetect:false,skipTitleBar:false});
  const wmDur=getDuration(watermarked); console.log(`    watermarked ${wmDur?.toFixed(1)}s ${Math.round(fs.statSync(watermarked).size/1024/1024)}MB`);
  const publicUrl=await presignUpload(watermarked); console.log(`    uploaded ${publicUrl}`);
  const postRes=await createReelPost(content,publicUrl); console.log(`    posted ${JSON.stringify(postRes).slice(0,600)}`);
  const postId=postRes.post?._id||postRes._id||postRes.id||postRes.data?._id||"";
  await new Promise(r=>setTimeout(r,3000));
  try{const vr=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization: `Bearer ${config.zernioApiKey}`}});const vj=JSON.parse(await vr.text());const p=vj.post||vj; console.log(`    verify mediaItems=${p.mediaItems?.length} type=${p.mediaItems?.[0]?.type} status=${p.platforms?.[0]?.status}`);}catch{}
  results.push({highlight,content,ytTitle:c.title,ytUrl:highlight.videoUrl,publicUrl,postId,duration:Math.round(dur),logo:logoPath,bar:"HIGH UP 110 left"});
  seen.add(key); try{fs.unlinkSync(raw);}catch{}; found=true; break;
 }
 if(!found) console.log(`  No valid candidate for ${pick.query}`);
}
console.log("\n=== VERIFY 2 ===");
for(const r of results){
 try{
  const res=await fetch(`${config.zernioBaseUrl}/posts/${r.postId}`,{headers:{Authorization: `Bearer ${config.zernioApiKey}`}});
  const j=JSON.parse(await res.text()); const p=j.post||j;
  const mi=p.mediaItems||[]; const plat=p.platforms?.[0];
  const okMedia=mi.length===1&&mi[0].type==="video"; const okPub=plat?.status==="published"||plat?.status==="publishing";
  const content=p.content||r.content; const teamsOk=content.toLowerCase().includes(r.highlight.homeTeam.toLowerCase().split(" ")[0]) && content.toLowerCase().includes(r.highlight.awayTeam.toLowerCase().split(" ")[0]);
  const logoOk=!!r.logo && fs.existsSync(r.logo);
  r.verified=okMedia&&okPub&&teamsOk&&logoOk;
  console.log(`${r.postId} ${r.highlight.tournament} ${r.highlight.year} ${r.highlight.homeTeam} vs ${r.highlight.awayTeam} media=${mi.length} type=${mi[0]?.type} published=${okPub} teamsOk=${teamsOk} logo=${logoOk} verified=${r.verified}`);
 }catch(e){console.log(`verify err ${r.postId} ${e.message}`);}
}
fs.writeFileSync("/tmp/post2_today_results.json",JSON.stringify(results,null,2));
console.log(`\n=== DONE ${results.length}/2 ===`);
console.log(JSON.stringify(results.map(r=>({postId:r.postId,tournament:r.highlight.tournament,year:r.highlight.year,teams:`${r.highlight.homeTeam} vs ${r.highlight.awayTeam}`,ytTitle:r.ytTitle,duration:r.duration,verified:r.verified})),null,2));
