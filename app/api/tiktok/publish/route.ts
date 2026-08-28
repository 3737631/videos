import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TIKTOK_COOKIES } from "@/lib/tiktokAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// TikTok permite hasta 287MB, pero limitamos a 100MB en server
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(TIKTOK_COOKIES.accessToken)?.value;
    const openId = cookieStore.get(TIKTOK_COOKIES.openId)?.value;
    const scope = cookieStore.get("tiktok_scope")?.value || "";

    if (!accessToken || !openId) {
      return NextResponse.json({ error: "No conectado a TikTok. Conecta tu cuenta primero." }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("video") as File | null;
    const title = (form.get("title") as string) || (form.get("caption") as string) || "Video viral con Creador Viral #fyp";
    const privacy = (form.get("privacy_level") as string) || "SELF_ONLY";
    const mode = (form.get("mode") as string) || "publish"; // publish | draft
    const disableComment = form.get("disable_comment") === "true";
    const disableDuet = form.get("disable_duet") === "true";
    const disableStitch = form.get("disable_stitch") === "true";

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "Falta el vídeo" }, { status: 400 });
    }
    if (file.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "Vídeo demasiado grande (máx 100MB)" }, { status: 400 });
    }

    const canPublish = scope.includes("video.publish");
    const canUpload = scope.includes("video.upload");
    const wantsPublish = mode === "publish";

    if (wantsPublish && !canPublish) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene permiso video.publish. Usa modo borrador o reconecta con ese scope.", needScope: "video.publish" },
        { status: 403 }
      );
    }
    if (!wantsPublish && !canUpload) {
      return NextResponse.json({ error: "Falta permiso video.upload" }, { status: 403 });
    }

    // Elegir endpoint según modo y scopes
    const endpoint = wantsPublish && canPublish
      ? "https://open.tiktokapis.com/v2/post/publish/video/init/"
      : "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

    const videoSize = file.size;
    const chunkSize = videoSize;
    const totalChunkCount = 1;

    const initBody = {
      post_info: {
        title: title.slice(0, 2200),
        privacy_level: privacy,
        disable_duet: disableDuet,
        disable_comment: disableComment,
        disable_stitch: disableStitch,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    };

    const initRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(initBody),
      cache: "no-store",
    });

    const initJson = await initRes.json();
    if (!initRes.ok || initJson.error?.code !== "ok") {
      const err = initJson.error || initJson;
      return NextResponse.json(
        { error: `Init falló: ${err.message || err.code || initRes.status}`, details: initJson },
        { status: initRes.status || 500 }
      );
    }

    const publishId: string = initJson.data?.publish_id;
    const uploadUrl: string = initJson.data?.upload_url;

    if (!publishId || !uploadUrl) {
      return NextResponse.json({ error: "Respuesta init incompleta", details: initJson }, { status: 500 });
    }

    // Subir el vídeo binario
    const arrayBuffer = await file.arrayBuffer();
    const contentType = file.type || "video/mp4";
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
        "Content-Length": String(videoSize),
      },
      body: arrayBuffer,
    });

    // TikTok a veces responde 200 con texto plano, otras 201
    if (!uploadRes.ok && uploadRes.status !== 201 && uploadRes.status !== 200) {
      const t = await uploadRes.text().catch(() => "");
      return NextResponse.json({ error: `Upload falló ${uploadRes.status}: ${t.slice(0, 500)}`, publish_id: publishId }, { status: 500 });
    }

    // Para video.publish, ya está publicado tras el upload. Para inbox, queda en borradores.
    // Opcional: consultar estado
    let statusInfo: unknown = null;
    try {
      // Solo si es publish, el vídeo tarda unos segundos en procesarse, pero ya está en cola
      statusInfo = { publish_id: publishId, endpoint: endpoint.includes("inbox") ? "draft" : "publish" };
    } catch {}

    return NextResponse.json({
      ok: true,
      publish_id: publishId,
      mode: endpoint.includes("inbox") ? "draft" : "publish",
      status: statusInfo,
      message: endpoint.includes("inbox")
        ? "Vídeo subido como borrador. Ábrelo en TikTok para publicarlo."
        : "Vídeo enviado a TikTok correctamente. Se publicará en breve.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
