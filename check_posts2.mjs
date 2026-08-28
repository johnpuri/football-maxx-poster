import "dotenv/config";
import { config } from "./src/config.js";
const res = await fetch(`${config.zernioBaseUrl}/posts?limit=30&status=published`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
const t = await res.text();
console.log(t.slice(0,12000));
