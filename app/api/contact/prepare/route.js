import { NextResponse } from "next/server";
import { getProduct, getMessages, saveMessage, updateContactStatus } from "@/lib/db";
import { generateSubject, generateMessage, generateVariants } from "@/lib/messages";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { productId, email_to, subject, message, video_id } = body || {};
  if (!productId) {
    return NextResponse.json({ error: "Falta el producto" }, { status: 400 });
  }
  if (!email_to || !message) {
    return NextResponse.json(
      { error: "Faltan el email o el mensaje" },
      { status: 400 }
    );
  }

  try {
    const product = await getProduct(productId);
    if (!product) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    const saved = await saveMessage(productId, {
      email_to,
      subject: subject || generateSubject(product),
      message,
      video_id: video_id || "",
      status: "preparado",
    });
    await updateContactStatus(productId, "contacto_preparado");

    return NextResponse.json({
      message: saved,
      variants: generateVariants(product),
      estado_contacto: "contacto_preparado",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al preparar el contacto" },
      { status: 500 }
    );
  }
}