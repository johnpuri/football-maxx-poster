import "dotenv/config";
import { config } from "./src/config.js";
const ids=["6a87b687548190c173852d7c","6a87b674548190c1738524d7"];
for(const id of ids){
  const res=await fetch(`${config.zernioBaseUrl}/posts/${id}/unpublish`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify({platform:"facebook"})});
  const txt=await res.text();
  console.log(`unpublish ${id} -> ${res.status} ${txt.slice(0,800)}`);
}
