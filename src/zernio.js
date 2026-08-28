/**
 * Zernio API client for Facebook Pages
 * Docs: https://docs.zernio.com/platforms/facebook + https://docs.zernio.com/posts/create-post
 * Auth: Bearer ZERNIO_API_KEY
 */
import { config } from "./config.js";
import fs from "fs";
import path from "path";

export function zernioHeaders() {
  if (!config.zernioApiKey) throw new Error("ZERNIO_API_KEY not set");
  return {
    Authorization: `Bearer ${config.zernioApiKey}`,
    "Content-Type": "application/json",
  };
}

export async function listProfiles() {
  const res = await fetch(`${config.zernioBaseUrl}/profiles`, { headers: zernioHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zernio listProfiles ${res.status}: ${text.slice(0,500)}`);
  return JSON.parse(text);
}

export async function listAccounts() {
  const res = await fetch(`${config.zernioBaseUrl}/accounts`, { headers: zernioHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zernio listAccounts ${res.status}: ${text.slice(0,500)}`);
  return JSON.parse(text);
}

// ---- Strict media upload helpers ----

/**
 * Presign upload via POST /media then PUT file to uploadUrl.
 * Strict validation: file must exist, size > 1MB, PUT must return 200,
 * publicUrl must be https://media.zernio.com/...
 * Returns publicUrl.
 */
export async function presignUploadStrict(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`presignUploadStrict: file not found ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size < 1_000_000) throw new Error(`presignUploadStrict: file too small ${stat.size} bytes (<1MB) ${filePath}`);
  const filename = path.basename(filePath);
  const res = await fetch(`${config.zernioBaseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.zernioApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType: "video/mp4" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`presign ${res.status}: ${text.slice(0,500)}`);
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`presign invalid JSON: ${text.slice(0,500)}`); }
  const uploadUrl = j.uploadUrl;
  const publicUrl = j.publicUrl || j.mediaUrl || j.url;
  if (!uploadUrl || !publicUrl) throw new Error(`presign missing urls: ${text.slice(0,500)}`);
  if (!publicUrl.startsWith("https://media.zernio.com")) throw new Error(`presign publicUrl not https://media.zernio.com — got ${publicUrl}`);
  const buf = fs.readFileSync(filePath);
  const put = await fetch(uploadUrl, { method: "PUT", body: buf, headers: { "Content-Type": "video/mp4" } });
  if (put.status !== 200) {
    const body = await put.text().then(s => s.slice(0,500)).catch(() => "");
    throw new Error(`upload PUT ${put.status} (expected 200): ${body}`);
  }
  // Optional: verify publicUrl HEAD is reachable after upload (best-effort)
  return publicUrl;
}

export function validateMediaUrlsStrict(mediaUrls) {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) throw new Error("STRICT VALIDATION FAILED: mediaUrls must be non-empty array");
  for (const u of mediaUrls) {
    if (typeof u !== "string" || !u.startsWith("https://media.zernio.com")) {
      throw new Error(`STRICT VALIDATION FAILED: mediaUrl must be https://media.zernio.com... got ${String(u).slice(0,120)}`);
    }
  }
}

/**
 * Create/publish post to Facebook Page via Zernio — STRICT validation.
 * Rejects any call where mediaUrls is empty or invalid before POST.
 */
export async function createFacebookPost({ content, mediaUrls = [], publishNow = true }) {
  if (!config.facebookAccountId) throw new Error("FACEBOOK_ACCOUNT_ID not set - run listAccounts/listProfiles to find it");
  // STRICT: content must be non-empty
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw new Error("STRICT VALIDATION FAILED: content empty — refusing to create empty post");
  }
  // STRICT: mediaUrls must be validated before POST — no empty array path
  validateMediaUrlsStrict(mediaUrls);
  const body = {
    content,
    platforms: [{ platform: "facebook", accountId: config.facebookAccountId }],
    publishNow,
    mediaUrls,
    mediaItems: mediaUrls.map((url) => ({ type: "video", url })),
  };
  const res = await fetch(`${config.zernioBaseUrl}/posts`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Zernio createPost ${res.status}: ${JSON.stringify(json).slice(0,600)}`);
  const payloadStr = JSON.stringify(json);
  if (/moved|rejected|blocked/i.test(payloadStr)) {
    throw new Error(`Zernio createPost Facebook error (moved/rejected/blocked) in response: ${payloadStr.slice(0,800)}`);
  }
  return json;
}

// ---- Post verification helpers ----

const FACEBOOK_ERROR_PATTERNS = /moved|rejected|blocked|removed|failed|error|unpublished/i;

export function containsFacebookError(text) {
  if (!text || typeof text !== "string") return false;
  return FACEBOOK_ERROR_PATTERNS.test(text);
}

export function extractPostId(result) {
  if (!result) return null;
  return result?.post?._id || result?.post?.id || result?._id || result?.id || result?.data?._id || result?.data?.id || null;
}

export async function getPost(postId) {
  const res = await fetch(`${config.zernioBaseUrl}/posts/${postId}`, { headers: zernioHeaders() });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Zernio getPost ${res.status}: ${JSON.stringify(json).slice(0,600)}`);
  return json.post || json.data || json;
}

export function isPostVerified(post) {
  if (!post) return { verified: false, reason: "post is null/undefined" };
  const raw = JSON.stringify(post).slice(0, 2000);
  if (containsFacebookError(raw)) {
    const lower = raw.toLowerCase();
    if (lower.includes("moved") || lower.includes("rejected") || lower.includes("blocked")) {
      return { verified: false, reason: `facebook error keyword in payload: ${raw.slice(0,300)}` };
    }
  }
  // STRICT: content must be non-empty
  if (!post.content || typeof post.content !== "string" || post.content.trim().length === 0) {
    return { verified: false, reason: "content empty" };
  }
  if (post.status !== "published") return { verified: false, reason: `status=${post.status} expected published` };
  if (!Array.isArray(post.mediaItems) || post.mediaItems.length === 0) return { verified: false, reason: "mediaItems empty/missing" };
  const hasVideo = post.mediaItems.some((m) => m.type === "video");
  if (!hasVideo) return { verified: false, reason: "mediaItems has no video" };
  if (!Array.isArray(post.platforms) || post.platforms.length === 0) return { verified: false, reason: "platforms empty" };
  const fb = post.platforms[0];
  if (fb.status !== "published") return { verified: false, reason: `platforms[0].status=${fb.status} expected published` };
  if (!fb.platformPostUrl) return { verified: false, reason: "platformPostUrl missing" };
  if (!fb.platformPostId) return { verified: false, reason: "platformPostId missing" };
  const psd = JSON.stringify(fb.platformSpecificData || "");
  if (containsFacebookError(psd)) {
    const lower2 = psd.toLowerCase();
    if (lower2.includes("moved") || lower2.includes("rejected") || lower2.includes("blocked") || lower2.includes("error")) {
      return { verified: false, reason: `platformSpecificData contains error: ${psd.slice(0,300)}` };
    }
  }
  if (post.mediaItems.some((m) => !m.url)) return { verified: false, reason: "mediaItems contains empty url" };
  return { verified: true, reason: "verified" };
}

export async function verifyPostPublished(postId, { retries = 2, delayMs = 3000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const post = await getPost(postId);
      const check = isPostVerified(post);
      if (check.verified) return { verified: true, post, reason: check.reason };
      if (attempt === retries) return { verified: false, post, reason: check.reason };
      console.log(`[verify] Attempt ${attempt + 1}/${retries + 1} not yet verified: ${check.reason} — retrying...`);
    } catch (e) {
      if (attempt === retries) return { verified: false, post: null, reason: `getPost failed: ${e.message}` };
      console.log(`[verify] getPost error attempt ${attempt + 1}: ${e.message} — retrying...`);
    }
  }
  return { verified: false, post: null, reason: "unknown" };
}

// Delete / unpublish helpers for post-publish check remediation
export async function deletePost(postId) {
  const res = await fetch(`${config.zernioBaseUrl}/posts/${postId}`, { method: "DELETE", headers: zernioHeaders() });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text.slice(0,800) };
}

export async function unpublishPost(postId, platform = "facebook") {
  const res = await fetch(`${config.zernioBaseUrl}/posts/${postId}/unpublish`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ platform }),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text.slice(0,800) };
}

export async function listPosts(limit = 20) {
  const url = new URL(`${config.zernioBaseUrl}/posts`);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, { headers: zernioHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`listPosts ${res.status}: ${text.slice(0,500)}`);
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  return Array.isArray(j) ? j : (j.data || j.posts || []);
}

/**
 * Scan last N posts and unpublish/delete any empty published posts (mediaItems 0 or content empty)
 */
export async function cleanupEmptyPosts(limit = 20) {
  const posts = await listPosts(limit);
  const emptyPublished = posts.filter(p => {
    const isPublished = p.status === "published" || (Array.isArray(p.platforms) && p.platforms.some(pl => pl.status === "published"));
    if (!isPublished) return false;
    const emptyMedia = !Array.isArray(p.mediaItems) || p.mediaItems.length === 0;
    const emptyContent = !p.content || p.content.trim().length === 0;
    return emptyMedia || emptyContent;
  });
  console.log(`[cleanup] Scanned ${posts.length} posts, found ${emptyPublished.length} empty published`);
  for (const p of emptyPublished) {
    const id = p._id || p.id;
    console.log(`[cleanup] Empty published ${id} — media=${p.mediaItems?.length||0} contentLen=${(p.content||"").length} — unpublishing...`);
    try {
      const un = await unpublishPost(id);
      console.log(`[cleanup] unpublish ${id} => ${un.status} ${un.body.slice(0,200)}`);
      if (!un.ok) {
        const del = await deletePost(id);
        console.log(`[cleanup] delete ${id} => ${del.status} ${del.body.slice(0,200)}`);
      }
    } catch (e) {
      console.warn(`[cleanup] failed ${id}: ${e.message}`);
    }
  }
  return { scanned: posts.length, cleaned: emptyPublished.length, ids: emptyPublished.map(p => p._id || p.id) };
}

export async function resolveFacebookAccount() {
  try {
    const accounts = await listAccounts();
    const list = Array.isArray(accounts) ? accounts : accounts.data || accounts.accounts || [];
    const fb = list.filter((a) => (a.platform || a.provider || "").toLowerCase() === "facebook");
    return fb;
  } catch {
    const profiles = await listProfiles();
    return profiles;
  }
}
