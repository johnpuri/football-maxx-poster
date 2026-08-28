import "dotenv/config"; import {config} from "./src/config.js"; import fs from "fs";
const res=await fetch(`${config.zernioBaseUrl}/posts?limit=50`,{headers:{Authorization:`Bearer ${config.zernioApiKey}`}});
const t=await res.text(); fs.writeFileSync("/tmp/posts50_raw.json", t); console.log("status",res.status,"len",t.length); console.log(t.slice(0,500));
