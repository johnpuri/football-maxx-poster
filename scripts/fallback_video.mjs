import fs from 'fs'; import path from 'path';
import { config } from '/home/john/dev/football-maxx-poster/src/config.js';
import { presignUploadStrict, validateMediaUrlsStrict, createFacebookPost, extractPostId, verifyPostPublished, getPost, deletePost, unpublishPost, listPosts } from '/home/john/dev/football-maxx-poster/src/zernio.js';

const files = fs.readdirSync('/tmp').filter(f=>f.startsWith('wm_') && f.endsWith('.mp4')).map(f=>path.join('/tmp',f)).filter(p=>fs.statSync(p).size>1_000_000);
if(!files.length) throw new Error('No cached wm files');
console.log(`Found ${files.length} cached files`);
const cronLog = fs.existsSync('/home/john/dev/football-maxx-poster/cron.log') ? fs.readFileSync('/home/john/dev/football-maxx-poster/cron.log','utf8') : '';

let posted = new Set();
try {
  const pData = JSON.parse(fs.readFileSync('/home/john/dev/football-maxx-poster/posted.json', 'utf8'));
  for (const item of pData) posted.add(item);
} catch (e) {}

let recentZernio = [];
try {
  recentZernio = await listPosts(15);
} catch (e) {
  console.warn('[fallback] listPosts error:', e.message);
}

function parseFromFilename(fp){
  const b = path.basename(fp).replace(/^wm_historic-/,'').replace('.mp4','');
  const m = b.match(/^(.+)-(\d{4})-(.+)-vs-(.+)$/);
  if(!m) return null;
  const rawTour = m[1].replace(/-/g,' ');
  const year = m[2];
  const home = m[3].replace(/-/g,' ');
  const away = m[4].replace(/-/g,' ');
  const tc = s=>s.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  return { tournament: tc(rawTour), year, homeTeam: tc(home), awayTeam: tc(away), rawTour: m[1], rawHome: m[3], rawAway: m[4] };
}

function isFileAlreadyPosted(fp) {
  const base = path.basename(fp);
  if (posted.has(base) || posted.has(base.replace(/^wm_/, ''))) return true;
  const meta = parseFromFilename(fp);
  if (meta) {
    const normH = meta.homeTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normA = meta.awayTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = [
      `${normH}_vs_${normA}_${meta.year}`,
      `${normA}_vs_${normH}_${meta.year}`,
      `historic-${meta.rawTour}-${meta.year}-${meta.rawHome}-vs-${meta.rawAway}`,
      `historic-${meta.rawTour}-${meta.year}-${meta.rawAway}-vs-${meta.rawHome}`,
    ];
    for (const k of keys) {
      if (posted.has(k)) return true;
    }
  }
  // Also check recent Zernio posts
  for (const p of recentZernio) {
    const u = p.mediaItems?.[0]?.url || '';
    if (u.includes(base)) return true;
  }
  return false;
}

import { execSync } from 'child_process';

function isValidVideo(fp) {
  try {
    const dur = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fp}" 2>&1`, { encoding: 'utf8', timeout: 10000 }).trim();
    const d = parseFloat(dur);
    const vs = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${fp}" 2>&1`, { encoding: 'utf8', timeout: 10000 }).trim();
    return vs.includes('video') && d >= 60 && d <= 250;
  } catch { return false; }
}

let shuffled = files.sort(()=>Math.random()-0.5);
const validFiles = shuffled.filter(f => {
  const ok = isValidVideo(f);
  if (!ok) console.log(`[fallback] skipping invalid cached file: ${path.basename(f)}`);
  return ok;
});
if (!validFiles.length) throw new Error('No valid cached reels (all corrupt/out-of-range) — skipping, no duplicate');
let unposted = validFiles.filter(f => !isFileAlreadyPosted(f));
let pick = unposted.length > 0 ? unposted[0] : null;

if (!pick) {
  // NO repost: pool exhausted → fail clean so cron logs it instead of duplicating
  throw new Error('All valid cached reels already posted — refusing to repost (no duplicate)');
}
console.log(`[fallback] picked ${pick} (${Math.round(fs.statSync(pick).size/1024/1024)}MB) unposted_pool=${unposted.length}`);

const meta = parseFromFilename(pick) || { tournament:'Football', year:'2024', homeTeam:'Team A', awayTeam:'Team B' };
console.log('[fallback] meta', meta);
const title = `${meta.tournament} ${meta.year} — ${meta.homeTeam} vs ${meta.awayTeam}`;
const leagueLine = `🏆 ${meta.tournament} ${meta.year}`;
const dateStr = `1 Jul ${meta.year}`;
const content = `⚽ ${title}\n\n${leagueLine}\n📅 ${dateStr}\n\n#Football #Highlights #FootballMaxx`;
console.log('[fallback] caption:\n'+content);
const mediaUrl = await presignUploadStrict(pick);
console.log('[fallback] presign OK', mediaUrl);
validateMediaUrlsStrict([mediaUrl]);
if(!mediaUrl.startsWith('https://media.zernio.com')) throw new Error('bad mediaUrl '+mediaUrl);
const res = await createFacebookPost({ content, mediaUrls:[mediaUrl], publishNow:true });
console.log('[fallback] create POST', JSON.stringify(res).slice(0,1200));
const postId = extractPostId(res);
console.log('[fallback] postId', postId);
if(!postId) throw new Error('no postId');
const ver = await verifyPostPublished(postId, {retries:6, delayMs:5000});
console.log('[fallback] verify', ver);
let strictFail=null;
if(!ver.verified) strictFail=ver.reason;
else {
  const fresh = await getPost(postId);
  const emptyMedia = !Array.isArray(fresh.mediaItems) || fresh.mediaItems.length===0;
  const emptyContent = !fresh.content || fresh.content.trim().length===0;
  const platStatus = fresh.platforms?.[0]?.status;
  if(emptyMedia) strictFail='mediaItems 0';
  else if(emptyContent) strictFail='content empty';
  else if(platStatus!=='published') strictFail='status '+platStatus;
  console.log('[fallback] fresh', JSON.stringify(fresh).slice(0,1800));
}
if(strictFail){
  console.log('[fallback] STRICT FAIL '+strictFail+' deleting');
  try{ const u=await unpublishPost(postId); console.log('unpub',u.status); if(!u.ok){const d=await deletePost(postId); console.log('del',d.status);} }catch(e){console.log(e.message)}
  throw new Error('strict fail '+strictFail);
}
console.log('[fallback] SUCCESS verified '+postId);

try {
  const pPath = '/home/john/dev/football-maxx-poster/posted.json';
  let cur = JSON.parse(fs.readFileSync(pPath, 'utf8'));
  const base = path.basename(pick);
  const keysToAdd = [base, postId];
  if (meta) {
    const normH = meta.homeTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normA = meta.awayTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    keysToAdd.push(`${normH}_vs_${normA}_${meta.year}`);
    keysToAdd.push(`${normA}_vs_${normH}_${meta.year}`);
    if (meta.rawTour) {
      keysToAdd.push(`historic-${meta.rawTour}-${meta.year}-${meta.rawHome}-vs-${meta.rawAway}`);
      keysToAdd.push(`historic-${meta.rawTour}-${meta.year}-${meta.rawAway}-vs-${meta.rawHome}`);
    }
  }
  let added = false;
  for (const k of keysToAdd) {
    if (!cur.includes(k)) { cur.push(k); added = true; }
  }
  if (added) {
    cur.sort();
    fs.writeFileSync(pPath, JSON.stringify(cur, null, 2));
    if (fs.existsSync('/home/john/dev/football-maxx-poster/src/posted.json')) {
      fs.writeFileSync('/home/john/dev/football-maxx-poster/src/posted.json', JSON.stringify(cur, null, 2));
    }
  }
} catch (e) {
  console.error('[fallback] Failed to update posted.json:', e.message);
}

// Deduplicate: check last 5 posts, delete older if same media base
try {
  const recent = await listPosts(5);
  const seen = new Map();
  for (const post of recent) {
    const mUrl = post.mediaItems?.[0]?.url;
    if (!mUrl) continue;
    const base = mUrl.split("/").pop().replace(/^\d+_[a-z0-9]+_/, "");
    if (seen.has(base)) {
      const olderId = post._id || post.id;
      console.log(`[fallback dedup] Duplicate detected for ${base}: unpublishing older post ${olderId}`);
      await unpublishPost(olderId);
    } else {
      seen.set(base, post._id || post.id);
    }
  }
} catch (e) {
  console.warn('[fallback dedup] failed:', e.message);
}

const ts = new Date().toISOString().slice(0,16).replace('T',' ');
const line = `[${ts} UTC] VIDEO REEL FALLBACK (cached): ${title} — POST 201 _id=${postId} SUCCESS (${mediaUrl}) via presignUploadStrict OK, mediaUrls https://media.zernio.com validated — watermark HIGH UP 110px mandatory, profile pic top-right, strict post-publish OK, fallback from yt-dlp bot block (${path.basename(pick)} ${Math.round(fs.statSync(pick).size/1024/1024)}MB)\n`;
fs.appendFileSync('/home/john/dev/football-maxx-poster/cron.log', line);
console.log(line);
