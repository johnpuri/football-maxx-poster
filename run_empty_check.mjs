import "dotenv/config";
import {config} from "./src/config.js";
const headers={Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"};
async function getPosts(limit=100,page=1){
  const u=new URL(`${config.zernioBaseUrl}/posts`);
  u.searchParams.set("limit",String(limit)); u.searchParams.set("page",String(page));
  const r=await fetch(u,{headers}); const t=await r.text();
  let j; try{j=JSON.parse(t)}catch{console.log(t.slice(0,2000));return []}
  return Array.isArray(j)?j:(j.data||j.posts||j.items||[]);
}
let all=[];
for(let p=1;p<=5;p++){ let posts=await getPosts(100,p); console.log(`page ${p} => ${posts.length}`); if(!posts.length) break; all.push(...posts); }
console.log(`TOTAL ${all.length}`);
// Check accounts
let ra=await fetch(`${config.zernioBaseUrl}/accounts`,{headers}); let ta=await ra.text(); let ja=JSON.parse(ta);
console.log(`ACCOUNTS ${ja.accounts?.length} IDs: ${ja.accounts?.map(a=>a._id+" page:"+a.selectedPageId).join(", ")}`);
// Filter Football Maxx: profileId 6a8676eba559a63e8c57715f or account 6a86777b77555aae013cac9c or page 1297501440113613
let fbPosts = all.filter(p=>{
  let s=JSON.stringify(p);
  return s.includes("1297501440113613") || s.includes("6a86777b77555aae013cac9c");
});
console.log(`FB-related posts ${fbPosts.length} out of ${all.length}`);
// Empty checks
let emptyPublished = all.filter(p=> p.status==="published" && (!p.mediaItems||p.mediaItems.length===0));
console.log(`EMPTY_PUBLISHED mediaItems 0 count: ${emptyPublished.length}`);
for(let e of emptyPublished.slice(0,10)){
  console.log(` - ${e._id} status=${e.status} contentLen=${(e.content||"").length} media=${e.mediaItems?.length} platforms=${JSON.stringify(e.platforms?.map(pl=>pl.status+":"+pl.platformPostId))} pageInPlatforms=${JSON.stringify(e.platforms?.map(pl=>pl.platformSpecificData?.__platformUserIdSnapshot))}`);
}
// Also empty content
let emptyContent = all.filter(p=> p.status==="published" && (!p.content||p.content.trim()===""));
console.log(`EMPTY_CONTENT_PUBLISHED count: ${emptyContent.length}`);
for(let e of emptyContent.slice(0,10)){
  console.log(` - ${e._id} media=${e.mediaItems?.length} content="${(e.content||"").slice(0,50)}"`);
}
// Try to find target 1DXJuJ9ifm or 61593237643467 or 122105028579441254
let targetIds=["1DXJuJ9ifm","61593237643467","122105028579441254"];
for(let tid of targetIds){
  let m=all.filter(p=> JSON.stringify(p).includes(tid));
  console.log(`MATCH ${tid}: ${m.length}`);
  if(m.length) console.log(JSON.stringify(m[0],null,2).slice(0,3000));
}
// If emptyPublished found, try unpublish
for(let p of emptyPublished){
  let id=p._id||p.id;
  console.log(`Unpublishing ${id}...`);
  let r=await fetch(`${config.zernioBaseUrl}/posts/${id}/unpublish`,{method:"POST",headers,body:JSON.stringify({platform:"facebook"})});
  console.log(` POST /posts/${id}/unpublish => ${r.status} ${(await r.text()).slice(0,800)}`);
}
console.log("DONE");
// Verify after
let verify=[];
for(let p=1;p<=3;p++){ let posts=await getPosts(100,p); if(!posts.length) break; verify.push(...posts); }
let stillEmpty=verify.filter(p=> p.status==="published" && (!p.mediaItems||p.mediaItems.length===0));
console.log(`VERIFY still empty published: ${stillEmpty.length}`);
