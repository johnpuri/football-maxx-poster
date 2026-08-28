import { pickValidHighlightFromCandidates } from './src/validate.js';
const q = "Serie A 2001 Roma vs Juventus highlights";
const base = {id:'test-serie', tournament:'Serie A', year:2001, homeTeam:'Roma', awayTeam:'Juventus', title:'Serie A 2001 — Roma vs Juventus', league:'Serie A 2001', query:q};
import { execSync } from 'child_process';
import fs from 'fs';
async function dl(url, id){
  const out = `/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g,"_")}.mp4`;
  try{
    console.log(`[dl] ${url} -> ${out}`);
    execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${out}" "${url}" 2>&1 | tail -n 10`, {timeout:120000, encoding:'utf8'});
    if(fs.existsSync(out)) { console.log(`[dl] size ${fs.statSync(out).size}`); return out; }
  }catch(e){ console.log(`[dl] error ${e.message.slice(0,800)}`)}
  return null;
}
const r = await pickValidHighlightFromCandidates(q, base, dl);
console.log("RESULT:", r ? r.highlight.title : "null");
