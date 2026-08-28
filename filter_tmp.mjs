import "dotenv/config";
import { config } from "/home/john/dev/football-maxx-poster/src/config.js";
import fs from "fs";
const res = await fetch(`${config.zernioBaseUrl}/posts?limit=50`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` }});
const j = JSON.parse(await res.text());
const posts = j.posts||j.data||[];
const keys=["Euro 2008","World Cup 2010","FIFA World Cup 2010","WC 2010"];
const filtered=posts.filter(p=>{
  const c=(p.content||"").toLowerCase();
  const status=p.platforms?.[0]?.status?.toLowerCase()||"";
  return status==="published" && keys.some(k=>c.includes(k.toLowerCase()));
});
console.log("MATCHED",filtered.length);
filtered.forEach(p=>console.log(p._id, JSON.stringify((p.content||"").split("\n")[0]), p.platforms?.[0]?.status));
fs.writeFileSync("/tmp/ids.json", JSON.stringify(filtered.map(p=>p._id)));
