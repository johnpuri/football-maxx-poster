import fs from "fs"; import path from "path"; import {execSync} from "child_process";
const dir="/tmp";
for(const f of fs.readdirSync(dir)){
  if(f.endsWith(".part") || f.endsWith(".ytdl") || f.endsWith(".m4a") || f.includes("footballmaxx") || f.startsWith("hist_") || f.startsWith("wm_") || f.startsWith("test_manual")){
    const p=path.join(dir,f);
    try{
      const s=fs.statSync(p);
      if(s.isDirectory()) continue;
      fs.unlinkSync(p);
      console.log(`deleted ${f} ${Math.round(s.size/1024/1024)}MB`);
    }catch(e){ console.log(`fail ${f}: ${e.message}`)}
  }
  if(f.includes("Frag") && f.endsWith(".part")){
    try{ fs.unlinkSync(path.join(dir,f)); console.log(`deleted frag ${f}`);}catch{}
  }
}
console.log("cleanup done");
try{ console.log(execSync("df -h /tmp 2>&1 | tail -n 5",{encoding:"utf8"})); }catch{}
try{ console.log(execSync("ls /tmp/*.mp4 2>&1 | head -n 20; ls /tmp/*.part 2>&1 | head -n 20; ls /tmp/*.m4a 2>&1 | head -n 20",{encoding:"utf8"})); }catch(e){ console.log(e.message)}
