/**
 * Zernio API client for Facebook Pages
 * Docs: https://docs.zernio.com/platforms/facebook + https://docs.zernio.com/posts/create-post
 * Auth: Bearer ZERNIO_API_KEY
 */
import { config } from "./config.js";

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

/**
 * Create/publish post to Facebook Page via Zernio
 * https://docs.zernio.com/posts/create-post
 */
export async function createFacebookPost({ content, mediaUrls = [], publishNow = true }) {
  if (!config.facebookAccountId) throw new Error("FACEBOOK_ACCOUNT_ID not set - run listAccounts/listProfiles to find it");
  const body = {
    content,
    platforms: [{ platform: "facebook", accountId: config.facebookAccountId }],
    publishNow,
  };
  if (mediaUrls.length) body.mediaUrls = mediaUrls; // Zernio may use mediaUrls or media
  const res = await fetch(`${config.zernioBaseUrl}/posts`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Zernio createPost ${res.status}: ${JSON.stringify(json).slice(0,600)}`);
  // Check for Facebook error keywords in success response (e.g. moved/rejected/blocked)
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
  // API returns { post: {...} } wrapper
  return json.post || json.data || json;
}

export function isPostVerified(post) {
  if (!post) return { verified: false, reason: "post is null/undefined" };
  const raw = JSON.stringify(post).slice(0, 2000);
  if (containsFacebookError(raw)) {
    // be precise: check known error fields
    const lower = raw.toLowerCase();
    if (lower.includes("moved") || lower.includes("rejected") || lower.includes("blocked")) {
      return { verified: false, reason: `facebook error keyword in payload: ${raw.slice(0,300)}` };
    }
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
  // Check platformSpecificData for error strings
  const psd = JSON.stringify(fb.platformSpecificData || "");
  if (containsFacebookError(psd)) {
    const lower2 = psd.toLowerCase();
    if (lower2.includes("moved") || lower2.includes("rejected") || lower2.includes("blocked") || lower2.includes("error")) {
      return { verified: false, reason: `platformSpecificData contains error: ${psd.slice(0,300)}` };
    }
  }
  // Check if mediaItems url empty
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
      // if not verified and not last attempt, continue polling
      if (attempt === retries) return { verified: false, post, reason: check.reason };
      console.log(`[verify] Attempt ${attempt + 1}/${retries + 1} not yet verified: ${check.reason} — retrying...`);
    } catch (e) {
      if (attempt === retries) return { verified: false, post: null, reason: `getPost failed: ${e.message}` };
      console.log(`[verify] getPost error attempt ${attempt + 1}: ${e.message} — retrying...`);
    }
  }
  return { verified: false, post: null, reason: "unknown" };
}

/**
 * Helper: resolve Facebook account id interactively by listing
 */
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
