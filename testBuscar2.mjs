import { chromium } from "playwright";
const url = "https://viralcreator.vercel.app/videos";
await new Promise(r=>setTimeout(r,5000));
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
page.on("response", async r => {
  if (r.url().includes("/api/feed") || r.url().includes("/api/dl")) {
    console.log("RESPONSE:", r.url(), r.status(), r.statusText());
    try { const t = await r.text(); console.log("BODY 200 chars:", t.slice(0,200)); } catch {}
  }
});
await page.goto(url, { waitUntil: "networkidle" });
await page.locator('input[placeholder*="tijeras"]').fill("tijeras con laser");
await page.locator('button:has-text("Buscar")').click();
await page.waitForTimeout(5000);
const overlay = page.locator('iframe[title="TikTok"]');
console.log("iframe visible:", await overlay.isVisible().catch(()=>false));
const src = await overlay.getAttribute("src").catch(()=>null);
console.log("src:", src);
if (src) {
  const full = new URL(src, url).toString();
  console.log("full src:", full);
  // Direct fetch from node to compare
  const res = await fetch(full, { headers: { "User-Agent": "Mozilla/5.0" } });
  console.log("Direct fetch status:", res.status, res.statusText);
  const txt = await res.text();
  console.log("Direct fetch len:", txt.length, "has feed:", txt.slice(0,120));
}
await page.screenshot({ path: "C:/Users/Paquito/AppData/Local/Temp/opencode/buscar2.png", fullPage: true });
console.log("screenshot done");
await page.waitForTimeout(3000);
await browser.close();
