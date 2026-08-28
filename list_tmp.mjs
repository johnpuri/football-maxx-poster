import "dotenv/config";
import { config } from "/home/john/dev/football-maxx-poster/src/config.js";
const res=await fetch(`${config.zernioBaseUrl}/posts?limit=20`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
const t=await res.text(); const j=JSON.parse(t);
const posts=j.posts||[];
console.log('total',posts.length);
posts.slice(0,20).forEach(p=>{
  console.log(p._id, (p.content||'').split('\n')[0].slice(0,120), 'status', p.platforms?.[0]?.status, 'media', p.mediaItems?.length, p.mediaItems?.[0]?.type, 'mediaUrl', (p.mediaItems?.[0]?.url||'').slice(0,60));
});
