import { NextResponse } from "next/server";
import { listProducts } from "@/lib/db";

export async function GET() {
  try {
    const products = await listProducts(100);
    return NextResponse.json({ products });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Error al leer el historial" },
      { status: 500 }
    );
  }
}