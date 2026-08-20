import { NextResponse } from "next/server";
import { deleteProduct } from "@/lib/db";

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