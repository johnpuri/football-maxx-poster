import {applyDynamicWatermark} from "./src/watermark.js";
import {requireTournamentLogo} from "./src/config.js";
import fs from "fs";
const logo=requireTournamentLogo("Premier League",2023);
const profile="/tmp/page_profile.jpg";
// default (with title bar)
let r1=applyDynamicWatermark("/tmp/test_raw.mp4",{tournament:"Premier League",year:2023,teamA:"Arsenal",teamB:"Liverpool",stage:"Final",logoPath:logo,watermarkPath:profile,output:"/tmp/test_wm1.mp4", dryRun:true, headerHeight:110});
console.log("with bar drawtext count:", (r1.filter.match(/drawtext/g)||[]).length, "has pad:", r1.filter.includes("pad="));
// skip title bar (fix double title)
let r2=applyDynamicWatermark("/tmp/test_raw.mp4",{tournament:"Premier League",year:2023,teamA:"Arsenal",teamB:"Liverpool",stage:"Final",logoPath:logo,watermarkPath:profile,output:"/tmp/test_wm2.mp4", dryRun:true, skipTitleBar:true});
console.log("skip bar drawtext count:", (r2.filter.match(/drawtext/g)||[]).length, "has pad:", r2.filter.includes("pad="), "cmd inputs:", (r2.cmd.match(/-i "/g)||[]).length);
if((r2.filter.match(/drawtext/g)||[]).length===0) console.log("PASS double-title fix: no duplicate drawtext when skipTitleBar");
else console.log("FAIL");
