import { NextResponse } from "next/server";
import { getProduct, updateContactStatus } from "@/lib/db";

const ESTADOS = ["no_contactado", "contacto_preparado", "contactado", "respuesta_recibida"];

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { productId, estado } = body || {};
  if (!productId || !ESTADOS.includes(estado)) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 });
  }

  try {
    const product = await getProduct(productId);
    if (!product) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    await updateContactStatus(productId, estado);
    return NextResponse.json({ ok: true, estado_contacto: estado });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al actualizar el estado" },
      { status: 500 }
    );
  }
}