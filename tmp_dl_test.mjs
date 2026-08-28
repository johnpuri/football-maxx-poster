import { execSync } from 'child_process';
import fs from 'fs';
let query="Bundesliga 2022 Leverkusen vs Bayern Munich highlights";
let out=execSync(`yt-dlp "ytsearch10:${query}" --dump-json --no-warnings 2>/dev/null`, {timeout:60000, encoding:'utf8', maxBuffer:15*1024*1024}).trim();
let cands=[];
for(let line of out.split("\n").filter(Boolean)){
  if(!line.trim().startsWith("{")) continue;
  try{ let j=JSON.parse(line); if(j.id) cands.push({id:j.id, title:j.title, view_count:j.view_count, like_count:j.like_count, duration:j.duration, uploader:j.uploader}); }catch{}
}
cands.sort((a,b)=>b.view_count-a.view_count);
console.log(cands.slice(0,5).map(c=>`${c.id} dur=${c.duration} views=${c.view_count} title=${c.title}`).join("\n"));
let c=cands[0];
console.log("testing download for", c.id);
try{
  let dlOut=execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "/tmp/test_dl_${c.id}.mp4" "https://www.youtube.com/watch?v=${c.id}" 2>&1 | tail -n 20`, {timeout:120000, encoding:'utf8'});
  console.log(dlOut.slice(-2000));
  console.log("exists", fs.existsSync(`/tmp/test_dl_${c.id}.mp4`), fs.existsSync(`/tmp/test_dl_${c.id}.mp4`)?fs.statSync(`/tmp/test_dl_${c.id}.mp4`).size:0);
  if(fs.existsSync(`/tmp/test_dl_${c.id}.mp4`)){
    let dur=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "/tmp/test_dl_${c.id}.mp4" 2>&1`, {encoding:'utf8'}).trim();
    console.log("duration", dur);
  }
}catch(e){ console.log("dl err", e.message.slice(0,2000)); console.log(e.stdout?.slice(-2000)); }
