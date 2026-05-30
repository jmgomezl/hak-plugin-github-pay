// Record a browser demo of the live github-pay landing page (playwright video).
// Usage: WEB_DEMO_ACCOUNT=0.0.x node scripts/record-web.mjs
// (run with a cwd that has `playwright` installed, e.g. the AICourt project)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const SITE = process.env.SITE || "https://github-pay.aivylabs.xyz";
const ACCOUNT = process.env.WEB_DEMO_ACCOUNT || "0.0.12345";
const OUT = "/tmp/ghpay-web";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 1180, height: 820 } },
});
const page = await ctx.newPage();

// Smooth-scroll helper
async function scrollTo(sel) {
  await page.evaluate((s) => {
    document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, sel);
}

console.log("→ loading", SITE);
await page.goto(SITE, { waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const v = document.querySelector("#s-pool")?.textContent;
  return v && v !== "—";
}, { timeout: 15000 }).catch(() => {});
await sleep(2500); // hold on hero + live stats

await scrollTo("#claim");
await sleep(1800);

// Type the account and claim
const input = page.locator("#acct");
await input.click();
for (const ch of ACCOUNT) {
  await input.type(ch, { delay: 70 });
}
await sleep(600);
await page.locator("#claimBtn").click();
console.log("→ claiming for", ACCOUNT);

// Wait for the success result
await page.waitForSelector("#result.ok", { timeout: 40000 }).catch(() => {});
await sleep(3500); // hold on the paid result + hashscan links

// Show the live receipts updating
await scrollTo("#receipts");
await sleep(3500);

// Back to top for a clean closing frame
await scrollTo("body");
await sleep(1500);

await ctx.close(); // flush video
await browser.close();
console.log("→ video saved in", OUT);
