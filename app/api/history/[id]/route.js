import { NextResponse } from "next/server";
import { getProduct, deleteProduct } from "@/lib/db";

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const product = await getProduct(id);
    if (!product) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json(product);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al leer el producto" },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  try {
    const ok = await deleteProduct(id);
    if (!ok) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al borrar" },
      { status: 500 }
    );
  }
}