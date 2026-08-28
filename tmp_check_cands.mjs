import { execSync } from 'child_process';
import fs from 'fs';
let query="Ligue 1 2024 PSG vs Monaco highlights";
let out=execSync(`yt-dlp "ytsearch10:${query}" --dump-json --no-warnings 2>/dev/null`, {encoding:'utf8', maxBuffer:15*1024*1024}).trim();
for(let line of out.split("\n").filter(Boolean)){
 if(!line.trim().startsWith("{")) continue;
 try{ let j=JSON.parse(line); console.log(`${j.id} view=${j.view_count} like=${j.like_count} title=${j.title}`)}catch{}
}
