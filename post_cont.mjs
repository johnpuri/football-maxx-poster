import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, requireTournamentLogo } from "./src/config.js";
import { formatPost } from "./src/formatter.js";
import { validateTripleMatch, parseHighlightFromTitle } from "./src/ytParser.js";

function getDuration(p){ try{ return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}" 2>&1`,{encoding:"utf8",timeout:10000}).trim()); }catch{ return null; } }
function ensureProfilePic(){ const p="/tmp/page_profile.jpg"; if(fs.existsSync(p) && fs.statSync(p).size>1000) return p; execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${p}" 2>/dev/null`); return p; }
async function presignUpload(fp){
  const fn=path.basename(fp); const sz=fs.statSync(fp).size;
  const r=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body: JSON.stringify({filename:fn, contentType:"video/mp4", size:sz})});
  const t=await r.text(); if(!r.ok) throw new Error(`presign ${r.status}: ${t.slice(0,800)}`); const j=JSON.parse(t);
  const up=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl; const pub=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;
  const finalPub=pub||up.split('?')[0];
  const buf=fs.readFileSync(fp); const put=await fetch(up,{method:"PUT", body:buf, headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`); return finalPub;
}
async function createReel(content, mediaUrl){
  const body={content, platforms:[{platform:"facebook", accountId:config.facebookAccountId}], publishNow:true, mediaItems:[{type:"video", url:mediaUrl}]};
  const r=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const t=await r.text(); let j; try{j=JSON.parse(t);}catch{j={raw:t}}; if(!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j).slice(0,800)}`); return j;
}
function downloadYt(id,out){ execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist -o "${out}" "https://www.youtube.com/watch?v=${id}" 2>&1 | tail -n 3`,{timeout:120000, encoding:"utf8"}); }
function trimIfNeeded(inp, out){
  const d=getDuration(inp); if(d>210){ execSync(`ffmpeg -y -ss 0 -t 150 -i "${inp}" -c copy "${out}" 2>/dev/null || ffmpeg -y -ss 0 -t 150 -i "${inp}" -c:v libx264 -preset ultrafast -crf 28 -c:a aac "${out}" 2>/dev/null`,{timeout:60000}); return out; } return inp;
}
function watermarkUltrafast(src, dst, tournament, year, teamA, teamB, stage, logoPath, profilePic){
  const cmd=`ffmpeg -y -i "${src}" -i "${profilePic}" -i "${logoPath}" -filter_complex "[1:v]scale=140:140:flags=lanczos:force_original_aspect_ratio=increase,crop=140:140,format=rgba,colorchannelmixer=aa=0.6[wm];[2:v]scale=-1:100:flags=lanczos[logo];[0:v]scale=1280:-2[scaled];[scaled]pad=iw:ih+110:0:110:color=black[base];[base][logo]overlay=10:10[withlogo];[withlogo]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${tournament} ${year}':x=(w-text_w)/2:y=12:fontsize=28:fontcolor=white[txt1];[txt1]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${teamA} vs ${teamB}':x=(w-text_w)/2:y=42:fontsize=22:fontcolor=white[txt2];[txt2]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${stage}':x=(w-text_w)/2:y=68:fontsize=18:fontcolor=white[txt3];[txt3][wm]overlay=W-w-5:115:format=auto" -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 96k -movflags +faststart "${dst}"`;
  execSync(cmd, {timeout:120000, encoding:"utf8"});
}

const remaining=[
  { id:"Ing5kq16n3U", tournament:"Copa America", year:2007, homeTeam:"Brazil", awayTeam:"Argentina", stage:"Final", ytTitle:"Brazil vs Argentina Copa America 2007 Final Highlights 3-0" },
  { id:"05ds1Q5vFEY", tournament:"Euro", year:2004, homeTeam:"France", awayTeam:"England", stage:"Group Stage", ytTitle:"France vs England Euro 2004 Highlights 2-1" },
  { id:"d65q_j_jBn4", tournament:"Serie A", year:2023, homeTeam:"AC Milan", awayTeam:"Inter Milan", stage:"Highlights", ytTitle:"AC Milan vs Inter Milan Serie A 2023 Highlights" },
];
// discover valid id for Serie A if needed
try{
  const chk=execSync(`yt-dlp "ytsearch1:AC Milan vs Inter Milan Serie A 2023 highlights" --get-id --no-warnings 2>/dev/null | head -n1`,{encoding:"utf8",timeout:15000}).trim();
  if(chk && /^[A-Za-z0-9_-]{11}$/.test(chk)) remaining[2].id=chk;
}catch{}

async function main(){
  const profilePic=ensureProfilePic();
  const results=[];
  for(let i=0;i<remaining.length;i++){
    const c=remaining[i];
    const raw=`/tmp/euro6_raw_cont_${i}_${c.id}.mp4`;
    const trimmed=`/tmp/euro6_trim_cont_${i}.mp4`;
    const wm=`/tmp/euro6_wm_cont_${i}.mp4`;
    console.log(`\n--- cont ${i} ${c.tournament} ${c.year} ${c.homeTeam} vs ${c.awayTeam} id=${c.id} ---`);
    if(!fs.existsSync(raw) || fs.statSync(raw).size<10000){
      try{ downloadYt(c.id, raw); }catch(e){ console.log("dl fail",e.message.slice(0,300)); continue; }
    }
    let d=getDuration(raw); console.log(` raw ${d?.toFixed(1)}s`);
    if(!d || d<10) continue;
    let src=raw;
    if(d>210){ console.log(" trim 150"); trimIfNeeded(raw, trimmed); src=trimmed; d=getDuration(src); console.log(` trimmed ${d?.toFixed(1)}`); }
    if(d<90 || d>210){ console.log(" out of range skip"); continue; }
    // thumb check
    const thumbUrl=`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`;
    const thumb=`/tmp/thumb_cont_${i}.jpg`;
    try{ execSync(`curl -sL "${thumbUrl}" -o "${thumb}" --max-time 10`,{timeout:12000}); }catch{}
    let logoPath; try{ logoPath=requireTournamentLogo(c.tournament, c.year); }catch(e){ console.log(e.message); continue; }
    const parsed={ tournament:c.tournament, year:c.year, homeTeam:c.homeTeam, awayTeam:c.awayTeam, stage:c.stage };
    const content=formatPost({ ...parsed, id:`cont-${i}`, title:`${parsed.tournament} ${parsed.year} — ${parsed.homeTeam} vs ${parsed.awayTeam}`, league:`${parsed.tournament} ${parsed.year}`, date:`${parsed.year}-07-01`, ytTitle:c.ytTitle });
    const wt={ tournamentYear:`${parsed.tournament} ${parsed.year}`, matchText:`${parsed.homeTeam} vs ${parsed.awayTeam}`, stage:parsed.stage };
    const triple=validateTripleMatch(parsed, c.ytTitle, content, wt);
    console.log(` triple ${triple.ok}`); if(!triple.ok){ console.log(triple.reason); continue; }
    console.log(" watermarking ultrafast...");
    try{ watermarkUltrafast(src, wm, parsed.tournament, parsed.year, parsed.homeTeam, parsed.awayTeam, parsed.stage, logoPath, profilePic); }catch(e){ console.log("wm fail",e.message.slice(0,400)); continue; }
    const wd=getDuration(wm); console.log(` wm ${wd?.toFixed(1)}s`);
    if(!wd || wd<90 || wd>210) continue;
    const pub=await presignUpload(wm); console.log(` uploaded ${pub}`);
    const postRes=await createReel(content, pub); const pid=postRes.post?._id||postRes._id||postRes.id||""; console.log(` posted ${pid}`);
    await new Promise(r=>setTimeout(r,3000));
    let verified=false; try{ const v=await fetch(`${config.zernioBaseUrl}/posts/${pid}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}}); const vj=JSON.parse(await v.text()); const p=vj.post||vj; verified=(p.mediaItems||[]).length===1 && p.mediaItems[0].type==="video" && p.platforms?.[0]?.status==="published"; console.log(` verify ${verified}`);}catch(e){ console.log(e.message.slice(0,200));}
    results.push({tournament:c.tournament, year:c.year, homeTeam:c.homeTeam, awayTeam:c.awayTeam, duration:Math.round(wd), postId:pid, verified});
  }
  fs.writeFileSync("/tmp/euro6_cont_results.json", JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e); process.exit(1)});
