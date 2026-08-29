import fs from 'fs';
import path from 'path';
import { config } from './src/config.js';

const items = [
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Diego_Maradona_1986.jpg',
    caption: `🇦🇷 HAND OF GOD — Maradona magic at Azteca ✨\nArgentina 2-1 England — 1986 FIFA World Cup Quarter-Final, Estadio Azteca, Mexico City — 22 June 1986. Diego Maradona scores the infamous Hand of God and four minutes later the Goal of the Century.\n\n#Maradona #HandOfGod #Argentina #England #WorldCup1986 #Azteca #FootballHistory #FootballMaxx`,
    filename: 'maradona_1986.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Lionel_Messi_20180626.jpg',
    caption: `🐐 MESSI'S MARADONA COPY — vs Getafe ✨\nFC Barcelona 5-2 Getafe — Copa del Rey Semi-Final 1st Leg, Camp Nou — 18 April 2007. 19-year-old Messi picks the ball at halfway, beats 5 defenders and scores a solo identical to Maradona '86.\n\n#Messi #Barcelona #Getafe #CopaDelRey #CampNou #2007 #FootballHistory #GOAT #FootballMaxx`,
    filename: 'messi_getafe_2007.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/8e/Zinedine_Zidane_by_Tasnim_01.jpg',
    caption: `🚀 ZIDANE VOLLEY — Glasgow perfection ✨\nBayer Leverkusen 1-2 Real Madrid — UEFA Champions League Final, Hampden Park, Glasgow — 15 May 2002. Zidane's left-foot volley from Roberto Carlos' cross — the greatest UCL final goal.\n\n#Zidane #RealMadrid #Leverkusen #UCL2002 #HampdenPark #ChampionsLeague #Volley #FootballHistory #FootballMaxx`,
    filename: 'zidane_volley_2002.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Andr%C3%A9s_Iniesta_2013.jpg',
    caption: `🇪🇸 INIESTA MAKES HISTORY — 116th-minute winner 🏆\nNetherlands 0-1 Spain — 2010 FIFA World Cup Final, Soccer City, Johannesburg — 11 July 2010. Andrés Iniesta scores in extra-time to give Spain its first World Cup.\n\n#Iniesta #Spain #Netherlands #WorldCup2010 #Johannesburg #LaRoja #FootballHistory #FootballMaxx`,
    filename: 'iniesta_2010.jpg'
  },
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b4/Lionel-Messi-Argentina-2022-FIFA-World-Cup_%28cropped%29.jpg',
    caption: `🌟 MESSI LIFTS THE CUP — The final piece 🏆\nArgentina 3-3 France (4-2 pens) — 2022 FIFA World Cup Final, Lusail Stadium — 18 December 2022. After a 36-year wait, Messi finally lifts the World Cup.\n\n#Messi #Argentina #WorldCup2022 #Lusail #WorldCupFinal #FootballHistory #FootballMaxx`,
    filename: 'messi_worldcup_2022.jpg'
  },
];

async function download(url, dest){
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
  if(!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`downloaded ${dest} ${buf.length} bytes from ${url}`);
  return dest;
}

for(const item of items){
  const tmpPath = `/tmp/${item.filename}`;
  console.log(`\n=== ${item.filename} ===`);
  try{
    await download(item.url, tmpPath);
    const buf = fs.readFileSync(tmpPath);
    if(buf.length < 5000) throw new Error(`file too small ${buf.length}`);
    const contentType = tmpPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    console.log(`presign ${item.filename} ${contentType} ${buf.length}`);
    const presignRes = await fetch(`${config.zernioBaseUrl}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.zernioApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: item.filename, contentType })
    });
    const pjText = await presignRes.text();
    console.log('presign', presignRes.status, pjText.slice(0,600));
    if(!presignRes.ok) throw new Error(`presign failed ${pjText.slice(0,400)}`);
    const pj = JSON.parse(pjText);
    const uploadUrl = pj.uploadUrl;
    const publicUrl = pj.publicUrl || pj.mediaUrl || pj.url;
    console.log('publicUrl', publicUrl);
    const put = await fetch(uploadUrl, { method: 'PUT', body: buf, headers: { 'Content-Type': contentType } });
    console.log('PUT', put.status, (await put.text()).slice(0,200));
    if(put.status !== 200) throw new Error(`PUT failed ${put.status}`);

    const body = {
      content: item.caption,
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
    const text = await res.text();
    console.log('POST', res.status, text.slice(0,1500));
    if(res.ok){
      const j = JSON.parse(text);
      const pid = j.post?._id || j.post?.id || j._id || j.id;
      console.log('POST ID', pid);
      await new Promise(r=>setTimeout(r,3000));
      const vRes = await fetch(`${config.zernioBaseUrl}/posts/${pid}`, { headers: { Authorization: `Bearer ${config.zernioApiKey}` } });
      console.log('verify', (await vRes.text()).slice(0,1000));
    }
    // small delay between posts to avoid rate limit
    await new Promise(r=>setTimeout(r,2000));
  }catch(e){
    console.error(`FAILED ${item.filename}:`, e.message);
  }
}
console.log('\nDONE');
