import { pickValidHighlightFromCandidates } from '/home/john/dev/football-maxx-poster/src/validate.js';
const base = { id: 'historic-fa-cup-2006-liverpool-vs-west-ham', title: "FA Cup 2006 Final — Liverpool vs West Ham", league: "FA Cup 2006", homeTeam:"Liverpool", awayTeam:"West Ham", tournament:"FA Cup", year:2006, date:"2006-07-01", query:"FA Cup 2006 round of 16 Liverpool vs West Ham highlights" };

function downloadFn(url, id){
  const {execSync} = awaitImport();
  return null;
}
// we need actual download fn from index
import { execSync } from 'child_process';
import fs from 'fs';
async function dl(url, id){
  const outPath = `/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`;
  try{
    console.log(`downloading ${url} -> ${outPath}`);
    execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${outPath}" "${url}" 2>&1 | tail -n 10`, { timeout: 120000, encoding: "utf8" });
    if(fs.existsSync(outPath)) console.log("size",fs.statSync(outPath).size);
    return fs.existsSync(outPath) ? outPath : null;
  }catch(e){ console.log("dl err",e.message.slice(0,300)); return null; }
}
function awaitImport(){}

const res = await pickValidHighlightFromCandidates(base.query, base, dl);
console.log("RESULT", res ? res.highlight.title + " " + res.videoPath : "null");
