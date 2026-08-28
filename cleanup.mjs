import fs from 'fs';
import path from 'path';
const d='/tmp';
const files=fs.readdirSync(d).filter(f=>f.startsWith('footballmaxx')||f.startsWith('post2')||f.startsWith('hist_wm')||f.startsWith('wm_today')||f.startsWith('test_'));
let c=0;
for(const f of files){
  try{ fs.unlinkSync(path.join(d,f)); c++; console.log('del',f);}catch(e){ console.log('err',f,e.message)}
}
console.log('deleted',c);
import { execSync } from 'child_process';
console.log(execSync('df -h | grep tmp', {encoding:'utf8'}));
console.log(execSync('ls /tmp/*.mp4 2>&1 | head', {encoding:'utf8'}));
