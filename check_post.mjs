import { getPost } from "./src/zernio.js";
const id='6a891f013dfa2880eae4d614';
try{
  const p=await getPost(id);
  console.log(JSON.stringify(p,null,2).slice(0,5000));
}catch(e){ console.error(e.message.slice(0,2000)); }
