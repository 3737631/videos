import { chromium } from "playwright";
const url = "https://viralcreator.vercel.app/videos";
console.log("Abriendo", url, "tras deploy...");
// Esperar deploy 40s
await new Promise(r => setTimeout(r, 40000));
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
page.on("console", m => console.log("BROWSER:", m.text()));
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
page.on("requestfailed", r => console.log("REQFAILED:", r.url(), r.failure()?.errorText));
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  console.log("Título:", await page.title());
  await page.waitForTimeout(1500);
  const input = page.locator('input[placeholder*="tijeras"]');
  await input.fill("tijeras con laser");
  console.log("Rellenado tijeras con laser");
  const buscar = page.locator('button:has-text("Buscar")');
  await buscar.click();
  console.log("Click Buscar");
  await page.waitForTimeout(3000);
  const overlay = page.locator('iframe[title="TikTok"]');
  const count = await overlay.count();
  console.log("Overlay iframe count:", count);
  if (count > 0) {
    const src = await overlay.getAttribute("src");
    console.log("iframe src:", src);
    // Esperar contenido iframe
    const frame = page.frameLocator('iframe[title="TikTok"]');
    try {
      await frame.locator('body').waitFor({ timeout: 10000 });
      const bodyText = await frame.locator('body').innerText();
      console.log("IFRAME body 300 chars:", bodyText.slice(0,300));
      if (bodyText.includes("TikTok bloqueó")) console.log("IFRAME muestra bloqueo amigable (no 404)");
      if (bodyText.includes("404") || bodyText.includes("NOT_FOUND")) console.log("IFRAME 404 DETECTADO");
    } catch(e){ console.log("Frame wait error:", e.message); }
  }
  // Ver errores 404 en network
  // Tomar screenshot
  await page.screenshot({ path: "C:/Users/Paquito/AppData/Local/Temp/opencode/buscar.png", fullPage: true });
  console.log("Screenshot guardado");
  await page.waitForTimeout(4000);
} catch(e){ console.log("ERROR:", e.message); }
await browser.close();
console.log("Fin test");
