#!/usr/bin/env node
import "dotenv/config";
import { listAccounts, listProfiles } from "./zernio.js";

async function main() {
  console.log("Listing Zernio accounts/profiles to find Facebook Page ID...\n");
  try {
    const a = await listAccounts();
    console.log("Accounts:", JSON.stringify(a, null, 2));
  } catch (e) { console.error("listAccounts error:", e.message); }
  try {
    const p = await listProfiles();
    console.log("\nProfiles:", JSON.stringify(p, null, 2));
  } catch (e) { console.error("listProfiles error:", e.message); }
  console.log("\n→ Copy the Facebook accountId into .env as FACEBOOK_ACCOUNT_ID");
}
main();
