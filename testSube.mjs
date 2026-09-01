import { chromium } from "playwright";
const url = "https://viralcreator.vercel.app/videos";
const clip = "C:/Users/Paquito/AppData/Local/Temp/opencode/ytpastas/yt-9FDVvWR91ww-8s.mp4";
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.locator('button:has-text("Seleccionar vídeos")').click();
await page.locator('input[type="file"]').last().setInputFiles(clip);
await page.waitForTimeout(2000);
await page.locator('button:has-text("Voz")').first().click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Crear Vídeo")').click();
let final = false;
for (let i = 0; i < 60 && !final; i++) {
  await page.waitForTimeout(1000);
  final = (await page.content()).includes("Guardar");
}
console.log("FINAL_VIDEO_CREATED:", final);
await browser.close();
process.exit(final ? 0 : 1);