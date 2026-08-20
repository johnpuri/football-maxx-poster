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
  return json;
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
