import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVideo } from "@/lib/db";

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const video = await getVideo(id);
    if (!video || !video.path || !fs.existsSync(video.path)) {
      return NextResponse.json({ error: "Vídeo no encontrado" }, { status: 404 });
    }
    const stat = fs.statSync(video.path);
    const range = request.headers.get("range");
    const mime = video.mime || "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunk = fs.readFileSync(video.path).subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=31536000",
        },
      });
    }

    const body = fs.readFileSync(video.path);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Error al leer el vídeo: ${error.message}` },
      { status: 500 }
    );
  }
}