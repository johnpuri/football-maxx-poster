import { pickValidHighlightFromCandidates, validateHighlight } from './src/validate.js';
import { execSync } from 'child_process';
import fs from 'fs';

const q = "La Liga 2010 Barcelona vs Real Madrid highlights";
const base = {id:'test-laliga', tournament:'La Liga', year:2010, homeTeam:'Barcelona', awayTeam:'Real Madrid', title:'La Liga 2010 — Barcelona vs Real Madrid 5-0', league:'La Liga 2010', query:q};

async function dl(url,id){
  const out=`/tmp/footballmaxx_${String(id).replace(/[^a-zA-Z0-9_-]/g,"_")}.mp4`;
  try{
    console.log(`[dl] start ${url}`);
    let o=execSync(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b" --merge-output-format mp4 --no-playlist --max-filesize 500M -o "${out}" "${url}" 2>&1 | tail -n 5`, {timeout:120000, encoding:'utf8'});
    console.log(o);
    if(fs.existsSync(out)) { console.log(`[dl] ok ${fs.statSync(out).size}`); return out; }
  }catch(e){ console.log(`[dl] err ${e.message.slice(0,600)}`)}
  return null;
}

// mimic internal candidate parsing to see what happens
try{
 let out=execSync(`yt-dlp "ytsearch10:${q}" --dump-json --no-warnings 2>/dev/null`, {timeout:60000, encoding:'utf8', maxBuffer:15*1024*1024}).trim();
 console.log("dump lines", out.split("\n").length);
 let cands=[];
 for(let line of out.split("\n").filter(Boolean)){
   if(!line.trim().startsWith("{")) continue;
   try{let j=JSON.parse(line); if(j.id) cands.push({id:j.id,title:j.title,thumbnail:j.thumbnail||`https://img.youtube.com/vi/${j.id}/hqdefault.jpg`,uploader:j.uploader||"",view_count:j.view_count||0,like_count:j.like_count||0});}catch{}
 }
 console.log("parsed", cands.length, cands.slice(0,3).map(c=>`${c.id} views=${c.view_count} ${c.title.slice(0,50)}`));
 cands.sort((a,b)=>(b.view_count||0)-(a.view_count||0));
 const hi=cands.filter(c=>(c.view_count||0)>=10000 && ((c.view_count>50000)||(c.like_count>1000)));
 console.log("hi",hi.length);
} catch(e){ console.log("dump fail", e.message.slice(0,500))}

console.log("calling pickValid...");
let r=await pickValidHighlightFromCandidates(q, base, dl);
console.log("pickValid result", r?r.highlight.title:"null");
