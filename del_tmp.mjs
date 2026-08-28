import "dotenv/config"; import { config } from "./src/config.js";
for(const id of ["6a87b687548190c173852d7c","6a87b674548190c1738524d7"]){
  const url=`${config.zernioBaseUrl}/posts/${id}`;
  console.log("DELETE",url);
  const r=await fetch(url,{method:"DELETE", headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
  console.log(id, r.status, (await r.text()).slice(0,1000));
}
