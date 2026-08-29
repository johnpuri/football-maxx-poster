import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';

// Pool of historical real images (Wikimedia Commons, public/free)
const POOL = [
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Lionel_Messi_20180626.jpg',
    caption: `🐐 MESSI'S MARADONA COPY — vs Getafe ✨\nFC Barcelona 5-2 Getafe — Copa del Rey Semi-Final 1st Leg, Camp Nou — 18 April 2007. 19-year-old Messi beats 5 defenders from halfway — pure Maradona déjà vu.\n\n#Messi #Barcelona #Getafe #CopaDelRey #2007 #FootballHistory #FootballMaxx`,
    filename: 'messi_getafe.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/d/d4/Maradona_cano_debut.jpg',
    caption: `🇦🇷 HAND OF GOD — Maradona magic at Azteca ✨\nArgentina 2-1 England — 1986 FIFA World Cup Quarter-Final, Estadio Azteca — 22 June 1986. The Hand of God + Goal of the Century in one game.\n\n#Maradona #HandOfGod #WorldCup1986 #Argentina #FootballHistory #FootballMaxx`,
    filename: 'maradona_1986.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Zinedine_Zidane_by_Tasnim_03.jpg',
    caption: `🚀 ZIDANE VOLLEY — Glasgow perfection ✨\nBayer Leverkusen 1-2 Real Madrid — UEFA Champions League Final, Hampden Park — 15 May 2002. Zidane's left-foot volley from the edge — the greatest final goal.\n\n#Zidane #RealMadrid #UCL2002 #HampdenPark #ChampionsLeague #FootballHistory #FootballMaxx`,
    filename: 'zidane_volley.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Andr%C3%A9s_Iniesta_21dec2006.jpg',
    caption: `🇪🇸 INIESTA — The 116th-minute legend 🏆\nNetherlands 0-1 Spain — 2010 FIFA World Cup Final, Soccer City, Johannesburg — 11 July 2010. Iniesta's extra-time winner gives Spain its first World Cup.\n\n#Iniesta #Spain #WorldCup2010 #FootballHistory #FootballMaxx`,
    filename: 'iniesta_2010.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b4/Lionel-Messi-Argentina-2022-FIFA-World-Cup_%28cropped%29.jpg',
    caption: `🏆 MESSI LIFTS THE CUP — The final piece ✨\nArgentina 3-3 France (4-2 pens) — 2022 FIFA World Cup Final, Lusail Stadium — 18 Dec 2022. Messi finally lifts the World Cup.\n\n#Messi #WorldCup2022 #Argentina #Lusail #FootballHistory #FootballMaxx`,
    filename: 'messi_wc2022.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Cristiano_Ronaldo_2018.jpg',
    caption: `✈️ RONALDO BICYCLE — Overhead perfection 🚲\nJuventus 0-3 Real Madrid — UEFA Champions League Quarter-Final, Allianz Stadium — 3 Apr 2018. Ronaldo's 140th UCL goal — an unstoppable bicycle kick.\n\n#Ronaldo #RealMadrid #Juventus #UCL2018 #BicycleKick #FootballHistory #FootballMaxx`,
    filename: 'ronaldo_bicycle.jpg'
  },
];

const pick = POOL[Math.floor(Math.random() * POOL.length)];
console.log(`[image-cron] picked ${pick.filename} ${pick.url}`);
const buf = Buffer.from(await (await fetch(pick.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).arrayBuffer());
if (buf.length < 5000) throw new Error(`download too small ${buf.length}`);
const tmpPath = `/tmp/cron_${pick.filename}`;
fs.writeFileSync(tmpPath, buf);
console.log(`[image-cron] downloaded ${buf.length} bytes`);

const ct = 'image/jpeg';
const pres = await fetch(`${config.zernioBaseUrl}/media`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${config.zernioApiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ filename: pick.filename, contentType: ct })
});
const t = await pres.text();
if (!pres.ok) throw new Error(`presign ${pres.status} ${t.slice(0,400)}`);
const j = JSON.parse(t);
const uploadUrl = j.uploadUrl, publicUrl = j.publicUrl || j.mediaUrl;
const put = await fetch(uploadUrl, { method: 'PUT', body: buf, headers: { 'Content-Type': ct } });
if (put.status !== 200) throw new Error(`PUT ${put.status} ${await put.text().then(s=>s.slice(0,200))}`);
console.log(`[image-cron] uploaded ${publicUrl}`);

const body = {
  content: pick.caption,
  platforms: [{ platform: 'facebook', accountId: config.facebookAccountId }],
  publishNow: true,
  mediaUrls: [publicUrl],
  mediaItems: [{ type: 'image', url: publicUrl }]
};
const res = await fetch(`${config.zernioBaseUrl}/posts`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${config.zernioApiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
const txt = await res.text();
console.log(`[image-cron] POST ${res.status} ${txt.slice(0,1000)}`);
if (!res.ok) throw new Error(`post failed ${txt.slice(0,400)}`);
console.log('[image-cron] DONE');
