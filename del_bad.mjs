import { config } from "./src/config.js";
const id='6a891f013dfa2880eae4d614';
const url=`${config.zernioBaseUrl}/posts/${id}`;
console.log(url);
for(const method of ["DELETE"]){
  const r=await fetch(url,{method, headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
  const t=await r.text();
  console.log(method, r.status, t.slice(0,1000));
}
