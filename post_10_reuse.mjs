import "dotenv/config";
import fs from "fs";
import path from "path";
import {config, requireTournamentLogo} from "./src/config.js";
import {formatPost} from "./src/formatter.js";
import {getDiverseBatch, finalToHighlight} from "./src/historical.js";

async function presignUpload(filePath){
  const filename=path.basename(filePath);
  const size=fs.statSync(filePath).size;
  const body={filename,contentType:"video/mp4",size};
  const res=await fetch(`${config.zernioBaseUrl}/media`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const text=await res.text();
  if(!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,800)}`);
  const j=JSON.parse(text);
  const uploadUrl=j.uploadUrl||j.url||j.presignedUrl||j.data?.uploadUrl;
  const publicUrl=j.publicUrl||j.publicURL||j.fileUrl||j.url||j.data?.publicUrl||j.data?.url;
  if(!uploadUrl) throw new Error(`presign missing ${text.slice(0,800)}`);
  const finalUrl=publicUrl||uploadUrl.split('?')[0];
  const buf=fs.readFileSync(filePath);
  const put=await fetch(uploadUrl,{method:"PUT",body:buf,headers:{"Content-Type":"video/mp4"}});
  if(!put.ok) throw new Error(`PUT ${put.status}: ${await put.text().then(s=>s.slice(0,500))}`);
  return finalUrl;
}
async function createReelPost(content, mediaUrl){
  const payloads=[
    {content,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaItems:[{type:"video",url:mediaUrl}]},
    {content,platforms:[{platform:"facebook",accountId:config.facebookAccountId}],publishNow:true,mediaUrls:[mediaUrl]},
  ];
  for(const body of payloads){
    const res=await fetch(`${config.zernioBaseUrl}/posts`,{method:"POST",headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const text=await res.text();
    let j;try{j=JSON.parse(text)}catch{j={raw:text}}
    if(res.ok) return j;
  }
  throw new Error("post failed");
}
const files=fs.readdirSync("/tmp").filter(f=>f.startsWith("wm")&&f.endsWith(".mp4")).map(f=>`/tmp/${f}`).filter(f=>fs.statSync(f).size>10000).slice(0,10);
console.log("files",files);
let batch=getDiverseBatch(10);
console.log("batch",batch.map(p=>`${p.tournament} ${p.year} ${p.match.homeTeam} vs ${p.match.awayTeam}`));
for(let i=0;i<10;i++){
  const file=files[i%files.length];
  // ensure logo exists for this pick
  const pick=batch[i];
  const logo=requireTournamentLogo(pick.tournament,pick.year);
  console.log(`${i+1} using ${file} for ${pick.tournament} ${pick.year} logo=${logo} exists=${fs.existsSync(logo)}`);
  const hl=finalToHighlight(pick.match,"");
  hl.league=`${pick.tournament} ${pick.year}`;
  hl.title=pick.title;
  hl.date=`${pick.year}-07-01`;
  const content=formatPost(hl);
  const url=await presignUpload(file);
  console.log(`uploaded ${url}`);
  const res=await createReelPost(content,url);
  const postId=res.post?._id||res._id||res.id||"";
  console.log(`posted ${postId}`);
  await new Promise(r=>setTimeout(r,3000));
  // verify
  const vRes=await fetch(`${config.zernioBaseUrl}/posts/${postId}`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
  const vj=JSON.parse(await vRes.text());
  const mediaItems=vj.post?.mediaItems||vj.mediaItems||[];
  console.log(`verify ${postId} mediaItems=${mediaItems.length} type=${mediaItems[0]?.type}`);
}
