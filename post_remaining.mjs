import fs from 'fs';
import { config } from './src/config.js';
const items = [
  { url:'https://upload.wikimedia.org/wikipedia/commons/d/d4/Maradona_cano_debut.jpg', caption:`🇦🇷 MARADONA — The Hand of God era ✨\nArgentina 2-1 England — 1986 FIFA World Cup Quarter-Final, Estadio Azteca — 22 June 1986. Diego Maradona punches past Peter Shilton for the Hand of God — football's most infamous goal.\n\n#Maradona #HandOfGod #Argentina #WorldCup1986 #Azteca #FootballHistory #FootballMaxx`, filename:'maradona_hand_1986.jpg'},
  { url:'https://upload.wikimedia.org/wikipedia/commons/f/f3/Zinedine_Zidane_by_Tasnim_03.jpg', caption:`🚀 ZIDANE VOLLEY — Glasgow perfection ✨\nBayer Leverkusen 1-2 Real Madrid — UEFA Champions League Final, Hampden Park, Glasgow — 15 May 2002. Zidane's iconic left-foot volley — still the greatest UCL final goal.\n\n#Zidane #RealMadrid #ChampionsLeague #UCL2002 #HampdenPark #Volley #FootballHistory #FootballMaxx`, filename:'zidane_2002.jpg'},
  { url:'https://upload.wikimedia.org/wikipedia/commons/e/ed/Andr%C3%A9s_Iniesta_21dec2006.jpg', caption:`🇪🇸 INIESTA — The 116th-minute legend 🏆\nNetherlands 0-1 Spain — 2010 FIFA World Cup Final, Soccer City, Johannesburg — 11 July 2010. Andrés Iniesta scores in extra-time to give Spain its first World Cup.\n\n#Iniesta #Spain #WorldCup2010 #Johannesburg #LaRoja #FootballHistory #FootballMaxx`, filename:'iniesta_2010_final.jpg'},
];
for(const item of items){
  const p=`/tmp/${item.filename}`;
  console.log(`\n=== ${item.filename} ===`);
  try{
    const r=await fetch(item.url,{headers:{'User-Agent':'Mozilla/5.0'}});
    if(!r.ok) throw new Error(`dl ${r.status}`);
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    const buf=fs.readFileSync(p);
    console.log(`dl ${buf.length}`);
    const ct='image/jpeg';
    const pres=await fetch(`${config.zernioBaseUrl}/media`,{method:'POST',headers:{Authorization:`Bearer ${config.zernioApiKey}`,'Content-Type':'application/json'},body:JSON.stringify({filename:item.filename,contentType:ct})});
    const t=await pres.text(); console.log('pres',pres.status,t.slice(0,500));
    if(!pres.ok) throw new Error(t.slice(0,300));
    const j=JSON.parse(t); const uploadUrl=j.uploadUrl, publicUrl=j.publicUrl||j.mediaUrl;
    const put=await fetch(uploadUrl,{method:'PUT',body:buf,headers:{'Content-Type':ct}}); console.log('PUT',put.status,(await put.text()).slice(0,100));
    const body={content:item.caption,platforms:[{platform:'facebook',accountId:config.facebookAccountId}],publishNow:true,mediaUrls:[publicUrl],mediaItems:[{type:'image',url:publicUrl}]};
    const res=await fetch(`${config.zernioBaseUrl}/posts`,{method:'POST',headers:{Authorization:`Bearer ${config.zernioApiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const txt=await res.text(); console.log('POST',res.status,txt.slice(0,1200));
    await new Promise(r=>setTimeout(r,2000));
  }catch(e){console.error('FAIL',e.message)}
}
console.log('DONE');
