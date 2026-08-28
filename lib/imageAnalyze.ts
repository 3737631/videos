// Análisis 100% cliente con MobileNet (TensorFlow.js) - sin backend
// Detecta qué producto es la foto (ej tijeras con laser -> "tijeras")

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
  "cellular telephone": "móvil",
  "remote control": "mando",
  bottle: "botella",
  "water bottle": "botella",
  "spray bottle": "limpiador",
};

function labelToProduct(label: string): string {
  const l = label.toLowerCase();
  for (const [k, v] of Object.entries(LABEL_TO_PRODUCT)) if (l.includes(k)) return v;
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
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("No se pudo leer la imagen"));
      setTimeout(() => rej(new Error("Timeout imagen")), 4000);
    });
    try {
      const model = await loadMobilenet();
      const preds = await model.classify(img);
      const top = preds?.[0]?.className || "";
      const product = labelToProduct(top);
      if (product && product.length > 2) return product;
    } catch (e) {
      console.warn("[VISION] mobilenet fallo, fallback nombre archivo", e);
    }
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    if (name.length > 2) return name.slice(0, 24);
    return "producto";
  } finally {
    URL.revokeObjectURL(url);
  }
}
