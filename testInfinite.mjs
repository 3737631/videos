import { chromium } from "playwright";
let attempt=0;
while(true){
  attempt++;
  console.log(`\n=== INTENTO ${attempt} ===`);
  const browser=await chromium.launch({headless:false});
  const page=await browser.newPage();
  page.on("console", m=>console.log("B:",m.text()));
  page.on("pageerror", e=>console.log("PAGEERR:",e.message));
  try{
    await page.goto("https://viralcreator.vercel.app/videos",{waitUntil:"networkidle", timeout:30000});
    await page.locator('input[placeholder*="tijeras"]').fill("tijeras con laser");
    await page.locator('button:has-text("Buscar")').click();
    console.log("Buscar click");
    await page.waitForTimeout(5000);
    const frame=page.frameLocator('iframe');
    await frame.locator('.card').first().waitFor({timeout:15000});
    console.log("Cards found", await frame.locator('.card').count());
    await frame.locator('.card').first().click();
    await page.waitForTimeout(600);
    await frame.locator('.card').nth(1).click();
    console.log("Selected 2");
    await page.waitForTimeout(1000);
    const listo=page.locator('button:has-text("Listo")');
    await listo.click();
    console.log("Listo click");
    // Esperar a que vaya a Voz/Música o a Procesando o a error
    for(let i=0;i<20;i++){
      await page.waitForTimeout(1000);
      const c=await page.content();
      if(c.includes("No hay clips")){ console.log("FAIL: No hay clips"); break; }
      if(c.includes("Procesando") || c.includes("Cargando momentos")) console.log(`[${i}s] Procesando...`);
      if(c.includes("Guardar") && c.includes("Otro")){ console.log("SUCCESS: finalVideo listo"); break; }
      if(c.includes("Elige modo")) console.log(`[${i}s] Elige modo visible`);
    }
    const final= (await page.content()).includes("Guardar");
    console.log(final ? "✅ INTENTO OK" : "❌ INTENTO FAIL");
    await page.screenshot({path:`C:/Users/Paquito/AppData/Local/Temp/opencode/inf${attempt}.png`, fullPage:true});
    if(final) { await browser.close(); break; }
  }catch(e){ console.log("ERROR:",e.message); }
  await browser.close();
  if(attempt>=5){ console.log("5 intentos, paro"); break; }
  await new Promise(r=>setTimeout(r,5000));
}
console.log("Fin tests infinitos");
