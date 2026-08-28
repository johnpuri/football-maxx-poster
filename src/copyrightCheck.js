/**
 * 5-min delayed copyright verification.
 * After posting, schedule check 5 min later via setTimeout.
 * If media removed (mediaItems 0 or deletedFromPlatform or status cancelled), then delete/unpublish, add to blacklist, and optionally retry.
 */
import { getPost, deletePost, unpublishPost } from "./zernio.js";

export function isRemoved(post) {
  if (!post) return { removed: true, reason: "post null" };
  if (post.status === "cancelled") return { removed: true, reason: `status cancelled` };
  if (!Array.isArray(post.mediaItems) || post.mediaItems.length === 0) return { removed: true, reason: "mediaItems 0 (copyright removed/empty)" };
  const plat = post.platforms?.[0];
  if (!plat) return { removed: true, reason: "platforms missing" };
  if (plat.status === "cancelled") return { removed: true, reason: `platforms[0].status cancelled` };
  if (plat.platformSpecificData?.deletedFromPlatform) return { removed: true, reason: `deletedFromPlatform true at ${plat.platformSpecificData.deletedAt||""}` };
  if (plat.platformSpecificData?.deletedAt) return { removed: true, reason: `deletedAt ${plat.platformSpecificData.deletedAt}` };
  return { removed: false, reason: "ok" };
}

export async function verifyFiveMin(postId, { retries=1 }={}) {
  for(let i=0;i<=retries;i++){
    try{
      const post = await getPost(postId);
      const c = isRemoved(post);
      if(c.removed) return { removed:true, post, reason:c.reason };
      if(i<retries) await new Promise(r=>setTimeout(r,3000));
    }catch(e){
      if(i===retries) return { removed:true, post:null, reason:`getPost failed: ${e.message}` };
    }
  }
  // re-check once
  const post = await getPost(postId);
  const c = isRemoved(post);
  return { removed:c.removed, post, reason:c.reason };
}

export function scheduleFiveMinCheck(postId, { onRemoved=null, blacklistCb=null, label="" }={}) {
  const FIVE_MIN = 5*60*1000;
  console.log(`[5min-check] Scheduled for ${postId} ${label} in 5 min (${new Date(Date.now()+FIVE_MIN).toISOString()})`);
  const timer = setTimeout(async()=>{
    console.log(`[5min-check] Running for ${postId} ${label}...`);
    try{
      const { removed, post, reason } = await verifyFiveMin(postId);
      if(removed){
        console.warn(`[5min-check] ✗ REMOVED ${postId}: ${reason} — unpublishing/deleting + blacklisting`);
        try{ const u=await unpublishPost(postId); console.log(`[5min-check] unpublish ${u.status} ${u.body.slice(0,200)}`); }catch(e){ console.warn(e.message); }
        try{ const d=await deletePost(postId); console.log(`[5min-check] delete ${d.status} ${d.body.slice(0,200)}`); }catch(e){ console.warn(e.message); }
        if(blacklistCb) try{ await blacklistCb(postId, reason); }catch(e){ console.warn(`blacklistCb fail ${e.message}`); }
        if(onRemoved) try{ await onRemoved(postId, post, reason); }catch(e){ console.warn(`onRemoved fail ${e.message}`); }
      } else {
        console.log(`[5min-check] ✓ STILL PUBLISHED ${postId} mediaItems=${post.mediaItems?.length} status=${post.status} plat=${post.platforms?.[0]?.status}`);
      }
    }catch(e){ console.warn(`[5min-check] error ${postId}: ${e.message}`); }
  }, FIVE_MIN);
  // don't keep node alive solely for this if everything else done? keep alive actually we want it to fire if process stays; unref so if process exits early it won't block, but for posting script we want to keep alive -> timer.ref()
  // caller can await by not unref-ing; we keep referenced
  return timer;
}
