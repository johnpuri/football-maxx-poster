import "dotenv/config";
import { config } from "./src/config.js";
const ids=["6a87b687548190c173852d7c","6a87b674548190c1738524d7","6a87ba095724b639de7e1048","6a87ba3f0c3cb88d9a0123e3"];
for(const id of ids){
  const r=await fetch(`${config.zernioBaseUrl}/posts/${id}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
  const t=await r.text(); const j=JSON.parse(t); const p=j.post||j;
  console.log("---",id);
  console.log("content:", JSON.stringify(p.content?.slice(0,300)));
  console.log("mediaItems", p.mediaItems?.length, p.mediaItems?.[0]?.type);
  console.log("status", p.platforms?.[0]?.status);
}
