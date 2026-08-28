import { pickValidHighlightFromCandidates } from './src/validate.js';
import dotenv from 'dotenv';
dotenv.config();
let base={id:'test-ligue1', title:'Ligue 1 2024 — PSG vs Monaco', league:'Ligue 1 2024', homeTeam:'PSG', awayTeam:'Monaco', tournament:'Ligue 1', year:2024, query:'Ligue 1 2024 PSG vs Monaco highlights'};
// simple download fn
import { execSync } from 'child_process';
import fs from 'fs';
async function dl(url, id){
  const outPath=`/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g,"_")}.mp4`;
  try {
    execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${outPath}" "${url}" 2>&1 | tail -n 5`, {timeout:120000, encoding:'utf8'});
    if(fs.existsSync(outPath) && fs.statSync(outPath).size>10000) return outPath;
  } catch(e){ console.log("dl fail", e.message.slice(0,400)) }
  return null;
}
let res=await pickValidHighlightFromCandidates(base.query, base, dl);
console.log("RESULT", JSON.stringify(res?{title:res.highlight.title, path:res.videoPath}:null, null,2));
