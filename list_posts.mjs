import "dotenv/config";
import { config } from "/home/john/dev/football-maxx-poster/src/config.js";
const r = await fetch(`${config.zernioBaseUrl}/posts?limit=50`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
const t = await r.text();
console.log("STATUS", r.status);
let j; try{ j=JSON.parse(t);}catch(e){ console.log(t.slice(0,5000)); process.exit(0); }
const posts = Array.isArray(j) ? j : (j.data || j.posts || []);
console.log("count", posts.length);
console.log(JSON.stringify(posts,null,2).slice(0,30000));
