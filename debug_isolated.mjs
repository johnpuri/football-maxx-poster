import { pickValidHighlightFromCandidates } from './src/validate.js';
import fs from 'fs';
import { execSync } from 'child_process';
let q="Bundesliga 2013 Bayern Munich vs Dortmund highlights";
let base={id:'test-b', tournament:'Bundesliga', year:2013, homeTeam:'Bayern Munich', awayTeam:'Dortmund', title:'Bundesliga 2013 — Bayern Munich vs Dortmund', league:'Bundesliga 2013', query:q};
async function dl(url,id){
  const out=`/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g,"_")}.mp4`;
  try{
    console.log(`[dl] ${url}`);
    execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${out}" "${url}" 2>&1 | tail -n 2`, {timeout:120000, encoding:'utf8'});
    if(fs.existsSync(out)) return out;
  }catch(e){console.log(e.message.slice(0,400))}
  return null;
}
console.log("calling pickValid isolated");
let r=await pickValidHighlightFromCandidates(q, base, dl);
console.log("result", r?r.highlight.title:"null");
