import "dotenv/config";
import { config } from "./src/config.js";
const r=await fetch(`${config.zernioBaseUrl}/posts?limit=10`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
const t=await r.text(); const j=JSON.parse(t); const posts=Array.isArray(j)?j:(j.data||j.posts||[]);
console.log("recent 10 posts:");
for(const p of posts.slice(0,10)){
  const plat=p.platforms?.[0];
  console.log(`${p._id} | ${plat?.status} | ${(p.content||"").split("\n")[0].slice(0,80)} | media=${p.mediaItems?.[0]?.type} dur? | ${plat?.platformPostUrl||""}`);
}
const published=posts.filter(p=>p.platforms?.[0]?.status==="published");
console.log(`\nPublished in last 10: ${published.length}`);
console.log("Last 6 published IDs:", posts.filter(p=>p.platforms?.[0]?.status==="published").slice(0,6).map(p=>p._id).join(", "));
