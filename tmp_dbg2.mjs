import { execSync } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv'; dotenv.config();
let query="Ligue 1 2024 PSG vs Monaco highlights";
try{
  let out=execSync(`yt-dlp "ytsearch10:${query}" --dump-json --no-warnings 2>/dev/null`, {timeout:30000, encoding:'utf8', maxBuffer:15*1024*1024}).trim();
  console.log("out lines", out.split("\n").length);
  let cands=[];
  for(let line of out.split("\n").filter(Boolean)){
    if(!line.trim().startsWith("{")) continue;
    try{ let j=JSON.parse(line); if(j.id) cands.push({id:j.id, title:j.title, view_count:j.view_count}) }catch{}
  }
  console.log("parsed", cands.length, cands.map(c=>c.id+":"+c.title.slice(0,40)).join(" | "));
}catch(e){ console.log("err",e.message.slice(0,500)) }

import { validateHighlight } from './src/validate.js';
let base={id:'test-ligue1', title:'Ligue 1 2024 — PSG vs Monaco', league:'Ligue 1 2024', homeTeam:'PSG', awayTeam:'Monaco', tournament:'Ligue 1', year:2024, query:query};
for(let c of [{id:'HdlnK1ay_mM', title:"Le PSG S'IMPOSE à Monaco avec un DOUBLÉ de Dembélé | 16ème journée - Ligue 1 McDonald's 24/25"}]){
  let h={...base, title:c.title, videoUrl:`https://www.youtube.com/watch?v=${c.id}`, embedUrl:`https://www.youtube.com/watch?v=${c.id}`, thumbnail:`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`, uploader:""};
  // test validate without video
  let r=await validateHighlight({...h, candidateTitle:c.title, ytTitle:c.title}, { localVideoPath:null, requireVideoFile:false, candidateTitle:c.title });
  console.log("validate no-video", r);
}
