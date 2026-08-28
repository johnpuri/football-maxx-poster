import fs from 'fs';
import { getRandomHistoricalPick } from './src/historical.js';
import { highlightPostedKeys } from './src/index.js';
const posted = new Set(JSON.parse(fs.readFileSync('./posted.json','utf8')));
let fresh=0, blocked=0;
for(let i=0;i<100;i++){
  const p = getRandomHistoricalPick();
  const fake = { id: 'test-'+i, homeTeam:p.match.homeTeam, awayTeam:p.match.awayTeam, year:p.year, tournament:p.tournament, league:p.tournament };
  const keys = highlightPostedKeys(fake);
  const isBlocked = keys.some(k=>posted.has(k));
  if(isBlocked) blocked++; else { fresh++; console.log('FRESH:', p.title, '|', p.tournament, p.year, p.stage, '|', keys[0]); }
}
console.log('fresh', fresh, 'blocked', blocked);
