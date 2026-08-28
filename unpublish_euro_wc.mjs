import "dotenv/config";
import { config } from "./src/config.js";
const ids = JSON.parse(await import("fs").then(fs=>fs.readFileSync("/tmp/ids.json","utf8")));
console.log("Unpublishing", ids);
for(const id of ids){
  const res=await fetch(`${config.zernioBaseUrl}/posts/${id}/unpublish`,{method:"POST", headers:{Authorization:`Bearer ${config.zernioApiKey}`,"Content-Type":"application/json"}, body:JSON.stringify({platform:"facebook"})});
  const txt=await res.text();
  console.log(`unpublish ${id} -> ${res.status} ${txt.slice(0,800)}`);
}
