import { NextResponse } from "next/server";
import { extractProduct } from "@/lib/scraper";
import { saveProduct } from "@/lib/db";

const ALIEXPRESS_RE = /^https?:\/\/([a-z0-9-]+\.)*aliexpress\.(com|ru|es|de|fr|it|pt|co\.uk|in|br|id|mx|jp|kr)\//i;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const url = (body?.url || "").trim();
  if (!ALIEXPRESS_RE.test(url)) {
    return NextResponse.json(
      { error: "URL invalida. Solo se aceptan enlaces de AliExpress." },
      { status: 400 }
    );
  }
  if (url.length > 2048) {
    return NextResponse.json({ error: "URL demasiado larga" }, { status: 400 });
  }

  try {
    const product = await extractProduct(url);
    const saved = await saveProduct(product);
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al extraer el producto" },
      { status: 502 }
    );
  }
}