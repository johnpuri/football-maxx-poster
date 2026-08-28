import { validateHighlight } from './src/validate.js';
import dotenv from 'dotenv'; dotenv.config();
let base={id:'test-ligue1', title:'Bundesliga 2022 — Leverkusen vs Bayern Munich', league:'Bundesliga 2022', homeTeam:'Leverkusen', awayTeam:'Bayern Munich', tournament:'Bundesliga', year:2022, query:'Bundesliga 2022 Leverkusen vs Bayern Munich highlights'};
let c={id:'w9eE8Cf-h_g', title:"Bayer Remain Undefeated! | Bayer Leverkusen - FC Bayern München | Highlights | MD 21 – Bundesliga", uploader:"Bundesliga"};
let h={...base, title:c.title, videoUrl:`https://www.youtube.com/watch?v=${c.id}`, embedUrl:`https://www.youtube.com/watch?v=${c.id}`, thumbnail:`https://img.youtube.com/vi/${c.id}/hqdefault.jpg`, uploader:c.uploader};
let r=await validateHighlight({...h, candidateTitle:c.title, ytTitle:c.title}, { localVideoPath:'/tmp/test_dl_w9eE8Cf-h_g.mp4', requireVideoFile:true, candidateTitle:c.title });
console.log(JSON.stringify(r, null,2));
