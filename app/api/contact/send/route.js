import { NextResponse } from "next/server";
import { getProduct, getMessages, updateContactStatus } from "@/lib/db";
import { sendEmail, mailtoUrl, emailConfig } from "@/lib/email";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { productId, message_id } = body || {};
  if (!productId || !message_id) {
    return NextResponse.json({ error: "Faltan el producto o el mensaje" }, { status: 400 });
  }

  try {
    const product = await getProduct(productId);
    if (!product) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }
    const messages = await getMessages(productId);
    const target = messages.find((m) => m.id === message_id);
    if (!target) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const cfg = emailConfig();
    if (!cfg.configured) {
      return NextResponse.json(
        {
          ok: false,
          error: "Email no configurado",
          code: "EMAIL_NOT_CONFIGURED",
          mailto: mailtoUrl({
            to: target.email_to,
            subject: target.subject,
            message: target.message,
          }),
        },
        { status: 200 }
      );
    }

    const result = await sendEmail({
      to: target.email_to,
      subject: target.subject,
      message: target.message,
    });

    if (result.ok) {
      await updateContactStatus(productId, "contactado");
      return NextResponse.json({ ok: true, id: result.id, provider: result.provider });
    }

    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al enviar el email" },
      { status: 500 }
    );
  }
}