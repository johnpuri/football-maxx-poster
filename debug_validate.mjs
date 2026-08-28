import {validateHighlight, isFifaHighRisk} from '/home/john/dev/football-maxx-poster/src/validate.js';
import {isCartoonVideoSync} from '/home/john/dev/football-maxx-poster/src/cartoonFilter.js';

const base={id:'test', title:'UCL 2013 Final — Bayern Munich vs Dortmund', league:'Champions League 2013', homeTeam:'Bayern Munich', awayTeam:'Dortmund', tournament:'Champions League', year:2013, date:'2013-07-01'};

const manual=[
{id:'otW--bzpfUI',title:'Dortmund vs Bayern Munich Extended Highlights | UCL Final 2012/2013 | Football Made Prime',uploader:'Football Made Prime',duration:561},
{id:'wA4ChhQ38GQ',title:'Bayern v Dortmund: 2013 UEFA Champions League final highlights UEFA',uploader:'UEFA',duration:107},
{id:'B42bKfsm2JA',title:'FC Bayern - Champions League Final vs. Dortmund | 2013 FC Bayern Munich',uploader:'FC Bayern Munich',duration:331},
{id:'CV8Mx7b_bTM',title:'Borussia Dortmund 4 x 2 Bayern Munich Supercup 2013/14 Goals & Highlights',uploader:'RptimaoTV',duration:619},
{id:'Qmt1j4HMzoE',title:'Dortmund vs FC Bayern Munich 2013 UCL Final highlights SUPER SPORTS SS',uploader:'SUPER SPORTS SS',duration:220}
];

for(const c of manual){
  const fifa=isFifaHighRisk({title:c.title, description:c.title, league:base.league, uploader:c.uploader});
  const cartoon=isCartoonVideoSync(c.title,'');
  console.log('CAND',c.id,'fifaRisk',fifa.risk?fifa.reason:'ok','cartoon',cartoon,'dur',c.duration);
  const h={...base, title:c.title, videoUrl:'https://www.youtube.com/watch?v='+c.id, embedUrl:'https://www.youtube.com/watch?v='+c.id, thumbnail:'https://img.youtube.com/vi/'+c.id+'/hqdefault.jpg', uploader:c.uploader, candidateTitle:c.title, ytTitle:c.title};
  const r=await validateHighlight(h,{skipVideoCheck:true, candidateTitle:c.title});
  console.log('  skipVideo validate:',r.valid, r.reason);
}
