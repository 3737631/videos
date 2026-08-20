import { NextResponse } from "next/server";
import { saveProduct } from "@/lib/db";

const MAX_LEN = {
  title: 300,
  marca: 100,
  modelo: 100,
  fabricante: 150,
  fabricante_email: 120,
  seller: 150,
  url: 2048,
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const url = (body?.url || "").trim();
  const title = (body?.title || "").trim();

  if (!url || !title) {
    return NextResponse.json(
      { error: "Faltan el enlace y el título del producto" },
      { status: 400 }
    );
  }
  for (const [key, max] of Object.entries(MAX_LEN)) {
    if (String(body?.[key] || "").length > max) {
      return NextResponse.json(
        { error: `El campo ${key} es demasiado largo` },
        { status: 400 }
      );
    }
  }

  const emailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const email = (body?.fabricante_email || "").trim();
  if (email && !emailRe.test(email)) {
    return NextResponse.json({ error: "Email del fabricante invalido" }, { status: 400 });
  }

  try {
    const saved = await saveProduct({
      url,
      title,
      price: (body?.price || "").trim(),
      currency: (body?.currency || "USD").trim(),
      image: (body?.image || "").trim(),
      seller: (body?.seller || "").trim(),
      store: (body?.seller || "").trim(),
      attributes: [
        ...(body?.marca ? [{ name: "Marca", value: body.marca }] : []),
        ...(body?.modelo ? [{ name: "Nombre del modelo", value: body.modelo }] : []),
        ...(body?.fabricante
          ? [{ name: "Fabricante", value: body.fabricante }]
          : []),
        ...(body?.fabricante_email
          ? [{ name: "Email del fabricante", value: body.fabricante_email }]
          : []),
      ],
      conformity: [],
      marca: (body?.marca || "").trim(),
      modelo: (body?.modelo || "").trim(),
      fabricante: (body?.fabricante || "").trim(),
      fabricante_email: email,
      fabricante_direccion: (body?.fabricante_direccion || "").trim(),
      fabricante_pais: (body?.fabricante_pais || "").trim(),
      confianza: body?.fabricante ? "media" : "no-verificado",
      source: "manual",
      blocked: "",
      estado_contacto: "no_contactado",
    });
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al guardar el producto" },
      { status: 500 }
    );
  }
}