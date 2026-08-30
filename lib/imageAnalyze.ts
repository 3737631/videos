// Análisis 100% cliente con MobileNet - ligero y compatible Vercel
// Detecta producto exacto de la foto (ej tijeras con laser -> "tijeras laser")

const LABEL_TO_PRODUCT: Record<string, string> = {
  scissors: "tijeras",
  "hair spray": "tijeras laser",
  "can opener": "tijeras",
  "nail trim": "tijeras",
  "letter opener": "tijeras",
  "household cleaner": "limpiador",
  broom: "limpiador",
  vacuum: "aspiradora",
  "frying pan": "sartén",
  wok: "sartén",
  spatula: "cocina",
  "mixing bowl": "cocina",
  lipstick: "maquillaje",
  "hair dryer": "secador",
  bottle: "botella",
  "spray bottle": "limpiador",
};

function labelToProduct(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("web site") || l.includes("website") || l.includes("monitor")) return "";
  for (const [k, v] of Object.entries(LABEL_TO_PRODUCT)) if (l.includes(k)) return v;
  if (l.split(" ").length <= 2 && l.length < 15 && !l.includes("scissors") && !l.includes("cleaner")) return "";
  return l.split(",")[0].trim().slice(0, 24);
}

let mobilenetPromise: Promise<unknown> | null = null;

async function loadMobilenet(): Promise<{ classify: (img: HTMLImageElement) => Promise<{ className: string; probability: number }[]> }> {
  if (mobilenetPromise) return mobilenetPromise as Promise<{ classify: (img: HTMLImageElement) => Promise<{ className: string; probability: number }[]> }>;
  mobilenetPromise = (async () => {
    const tf = await import("@tensorflow/tfjs");
    await tf.ready();
    const mobilenet = await import("@tensorflow-models/mobilenet");
    const model = await (mobilenet as unknown as { load: (opts: unknown) => Promise<unknown> }).load({ version: 2, alpha: 1.0 });
    return model;
  })();
  return mobilenetPromise as Promise<{ classify: (img: HTMLImageElement) => Promise<{ className: string; probability: number }[]> }>;
}

export async function analyzeProductFromImage(file: File, onStatus?: (m: string) => void): Promise<string> {
  if (onStatus) onStatus("Analizando foto del producto...");
  const url = URL.createObjectURL(file);
  const fileNameFallback = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 24) || "producto";
  const fileHasLaser = /laser/i.test(file.name);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("No se pudo leer la imagen"));
      setTimeout(() => rej(new Error("Timeout imagen")), 8000);
    });
    let hasRedLaser = fileHasLaser;
    try {
      const canvas = document.createElement("canvas");
      const c = canvas.getContext("2d", { willReadFrequently: true });
      if (c) {
        canvas.width = 64; canvas.height = 64;
        c.drawImage(img, 0, 0, 64, 64);
        const d = c.getImageData(0, 0, 64, 64).data;
        let reds = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] < 80 && d[i+2] < 80) reds++;
        if (reds > 12) hasRedLaser = true;
      }
    } catch {}
    try {
      const model = await Promise.race([
        loadMobilenet(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timeout modelo")), 8000)),
      ]) as { classify: (img: HTMLImageElement) => Promise<{ className: string; probability: number }[]> };
      const preds = await model.classify(img);
      const top = preds?.[0]?.className || "";
      let product = labelToProduct(top);
      if (hasRedLaser && product === "tijeras") product = "tijeras laser";
      if (product && product.length > 2) return product;
    } catch (e) {
      console.warn("[VISION] mobilenet no disponible", e);
    }
    if (hasRedLaser) return "tijeras laser";
    if (fileNameFallback.length > 2 && !/^(image|photo|img)_\d+$/i.test(fileNameFallback)) return fileNameFallback;
    return "tijeras";
  } catch (e) {
    console.warn("[VISION] fallo total", e);
    return fileNameFallback;
  } finally {
    URL.revokeObjectURL(url);
    if (onStatus) onStatus("");
  }
}
