import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { saveVideo } from "@/lib/db";

export const config = {
  api: { bodyParser: false },
};

const ALLOWED = {
  "video/mp4": ["mp4"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
};
const MAX_SIZE = 25 * 1024 * 1024;

export async function POST(request) {
  const productId = request.headers.get("x-product-id") || "";
  if (!productId) {
    return NextResponse.json({ error: "Falta el producto" }, { status: 400 });
  }

  try {
    const form = await request.formData();
    const file = form.get("video");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No se recibió ningún vídeo" }, { status: 400 });
    }

    const type = String(file.type || "").toLowerCase();
    if (!ALLOWED[type]) {
      return NextResponse.json(
        { error: "Formato de vídeo no compatible." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "El vídeo es demasiado grande." },
        { status: 413 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "El vídeo está vacío" }, { status: 400 });
    }

    const ext = ALLOWED[type][0];
    const id = crypto.randomUUID();
    const dir = path.join(process.cwd(), "data", "uploads");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${id}.${ext}`;
    const target = path.join(dir, filename);

    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(target, buf);

    const record = await saveVideo(productId, {
      filename: file.name || filename,
      size: file.size,
      mime: type,
      path: target,
    });

    return NextResponse.json({
      id: record.id,
      filename: record.filename,
      size: file.size,
      mime: type,
      url: `/api/videos/${record.id}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Error al subir el vídeo: ${error.message}` },
      { status: 500 }
    );
  }
}