import fs from "fs";
import path from "path";
const dir="/tmp";
for(const f of fs.readdirSync(dir)){
  if(f.endsWith(".mp4") && !f.includes("footballmaxx_historic-euro-2000")){
    const p=path.join(dir,f);
    try{ const s=fs.statSync(p).size; fs.unlinkSync(p); console.log(`deleted ${f} ${Math.round(s/1024/1024)}MB`);}catch(e){console.log(e.message)}
  }
  if(f.startsWith("hist_wm_") && f.endsWith(".mp4")){
    try{ fs.unlinkSync(path.join(dir,f)); console.log(`deleted ${f}`);}catch{}
  }
}
console.log("cleanup done");
try{
  const out=fs.readdirSync(dir).filter(f=>f.endsWith(".mp4")).slice(0,20);
  console.log(out.join("\n"));
}catch{}
import {execSync} from "child_process";
try{ console.log(execSync("df -h /tmp 2>&1 | tail -n 5",{encoding:"utf8"})); }catch{}
