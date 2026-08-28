const id="6a88ca890267ec3de041eede";
const res=await fetch(`https://zernio.com/api/v1/posts/${id}/unpublish`,{method:"POST", headers:{Authorization:`Bearer ${process.env.ZERNIO_API_KEY}`,"Content-Type":"application/json"}, body:JSON.stringify({platform:"facebook"})});
const t=await res.text();
console.log(res.status+":"+t.slice(0,800));
