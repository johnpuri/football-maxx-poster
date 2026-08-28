import {applyDynamicWatermark} from "./src/watermark.js";
import {requireTournamentLogo} from "./src/config.js";
import {execSync} from "child_process";
import fs from "fs";
const raw="/tmp/test_raw.mp4";
const out="/tmp/test_wm.mp4";
// create 5s test video if not exists
if(!fs.existsSync(raw)){
  execSync(`ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=5 -c:v libx264 -pix_fmt yuv420p "${raw}"`);
}
const logo=requireTournamentLogo("Premier League",2023);
console.log("logo",logo, fs.existsSync(logo));
const profile="/tmp/page_profile.jpg";
if(!fs.existsSync(profile)) execSync(`ffmpeg -y -f lavfi -i color=c=white:s=140x140 -frames:v 1 "${profile}"`);
applyDynamicWatermark(raw,{tournament:"Premier League",year:2023,teamA:"Arsenal",teamB:"Liverpool",stage:"Final",logoPath:logo,watermarkPath:profile,output:out,headerHeight:110,logoScaleH:100});
console.log("watermarked",out,fs.statSync(out).size);
execSync(`ffmpeg -y -i "${out}" -vf "thumbnail" -frames:v 1 /tmp/test_thumb.jpg`);
console.log("thumb /tmp/test_thumb.jpg");
