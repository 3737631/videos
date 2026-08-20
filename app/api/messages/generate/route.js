import { NextResponse } from "next/server";
import { getProduct } from "@/lib/db";
import { generateSubject, generateVariants } from "@/lib/messages";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { productId } = body || {};
  if (!productId) {
    return NextResponse.json({ error: "Falta el producto" }, { status: 400 });
  }

  try {
    const product = await getProduct(productId);
    if (!product) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({
      subject: generateSubject(product),
      variants: generateVariants(product),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al generar el mensaje" },
      { status: 500 }
    );
  }
}