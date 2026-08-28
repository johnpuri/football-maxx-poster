import { listPosts } from "./src/zernio.js";
const p = await listPosts(5);
console.log(JSON.stringify(p,null,2).slice(0,6000));
