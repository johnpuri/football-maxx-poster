import {execSync} from "child_process";
const ids=["GSn2Q-gxc_k","3ojXHf293M8","5mLnuCORMrU","XHASxPuudPc","5LyiMOAUTrs","Ing5kq16n3U"];
for(const id of ids){
  try{
    const out=execSync(`yt-dlp --dump-json "https://www.youtube.com/watch?v=${id}" --no-warnings 2>/dev/null | python3 -c "import sys,json; j=json.load(sys.stdin); print(repr(j.get('title'))+\"|\"+str(j.get('duration'))+\"|\"+str(j.get('uploader')))"`, {encoding:"utf8", timeout:15000});
    console.log(id, out.trim());
  }catch(e){ console.log(id,"ERR",e.message.slice(0,200));}
}
