import "dotenv/config";
import { config } from "./src/config.js";
console.log("fb:", config.facebookAccountId ? config.facebookAccountId.slice(0,12)+"..." : "MISSING");
console.log("zKey:", config.zernioApiKey ? config.zernioApiKey.slice(0,12)+"..." : "MISSING");
console.log("base:", config.zernioBaseUrl);
try {
  const res = await fetch(`${config.zernioBaseUrl}/accounts`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
  const t = await res.text();
  console.log("accounts status", res.status, t.slice(0,4000));
  const res2 = await fetch(`${config.zernioBaseUrl}/profiles`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
  const t2 = await res2.text();
  console.log("profiles status", res2.status, t2.slice(0,4000));
} catch(e){ console.log("err", e.message)}
