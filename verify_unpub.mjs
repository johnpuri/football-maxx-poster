import "dotenv/config";
import { config } from "./src/config.js";
const ids=["6a87bf0571649ebc76bdc6d9","6a87bd61acfdf9e13b9e10cf","6a87ba095724b639de7e1048","6a87af321ad9733898ab50a7"];
for(const id of ids){
  const r=await fetch(`${config.zernioBaseUrl}/posts/${id}`, {headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
  const t=await r.text(); const j=JSON.parse(t); const p=j.post||j;
  console.log(id, p.platforms?.[0]?.status, JSON.stringify((p.content||"").slice(0,80)));
}
