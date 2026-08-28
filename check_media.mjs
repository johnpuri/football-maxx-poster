import { listPosts } from "./src/zernio.js";
const p = await listPosts(20);
for(const post of p){
  const hasMedia = post.mediaItems?.length || 0;
  const status = post.status;
  const pub = post.platforms?.[0]?.status;
  if(hasMedia>0) { console.log(`FOUND MEDIA ${post._id} status=${status} plat=${pub} media=${hasMedia} content=${post.content?.slice(0,60)}`); console.log(JSON.stringify(post).slice(0,2000)); break; }
}
let count=0;
for(const post of p){
  console.log(`${post._id} status=${post.status} plat=${post.platforms?.[0]?.status} media=${post.mediaItems?.length||0} content=${(post.content||'').slice(0,50)}`);
  if(++count>15) break;
}
