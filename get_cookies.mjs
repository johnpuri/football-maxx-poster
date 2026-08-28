import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.launch({args:['--no-sandbox']});
const ctx = await browser.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'});
const page = await ctx.newPage();
await page.goto('https://www.youtube.com/results?search_query=Premier+League+highlights', {waitUntil:'domcontentloaded', timeout:30000});
await page.waitForTimeout(7000);
const cookies = await ctx.cookies();
console.log(`Got ${cookies.length} cookies`);
let netscape = "# Netscape HTTP Cookie File\n";
for(const c of cookies){
  const domain = c.domain;
  const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const path = c.path;
  const secure = c.secure ? 'TRUE' : 'FALSE';
  const expiry = c.expires && c.expires>0 ? Math.floor(c.expires) : 0;
  netscape += `${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}\n`;
}
fs.writeFileSync('/tmp/youtube_cookies.txt', netscape);
console.log('Written lines', netscape.split('\n').length);
await browser.close();
