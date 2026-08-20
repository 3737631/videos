import { NextResponse } from "next/server";
import { extractProduct } from "@/lib/scraper";
import { saveProduct } from "@/lib/db";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const url = (body?.url || "").trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    return NextResponse.json({ error: "URL invalida" }, { status: 400 });
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