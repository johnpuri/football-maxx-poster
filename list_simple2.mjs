import fs from "fs";
import { execSync } from "child_process";
const cfg = fs.readFileSync("/home/john/dev/football-maxx-poster/.env","utf8");
const key = cfg.match(/ZERNIO_API_KEY=(.*)/)[1].trim();
const base = (cfg.match(/ZERNIO_BASE_URL=(.*)/)?.[1].trim() || "https://zernio.com/api/v1");
const r = await fetch(`${base}/posts?limit=10`, { headers: { Authorization: `Bearer ${key}` }});
const t = await r.text();
const j = JSON.parse(t);
const posts = Array.isArray(j) ? j : (j.data||j.posts||[]);
for(const p of posts){
  console.log(`${p._id} | ${p.content?.split("\n")[0]?.slice(0,80)} | media=${p.mediaItems?.length} type=${p.mediaItems?.[0]?.type} | fb=${p.platforms?.[0]?.status} url=${p.platforms?.[0]?.platformPostUrl?.slice(0,40)}`);
}
