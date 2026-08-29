import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TIKTOK_COOKIES, isTikTokConfigured, getMissingTikTokVars } from "@/lib/tiktokAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!isTikTokConfigured()) {
      return NextResponse.json({
        connected: false,
        reason: "not_configured",
        missing: getMissingTikTokVars(),
        hint: "Las pusiste en Shared pero no vinculadas. Ve a Vercel → Settings → Environment Variables → Shared → Link to Project → selecciona viralcreator, o añádelas directamente en Production para viralcreator y haz Redeploy. Luego prueba en https://viralcreator.vercel.app/videos (github.io siempre 404).",
      });
    }
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(TIKTOK_COOKIES.accessToken)?.value;
    const openId = cookieStore.get(TIKTOK_COOKIES.openId)?.value;
    const expiresAt = cookieStore.get(TIKTOK_COOKIES.expiresAt)?.value;
    const userName = cookieStore.get(TIKTOK_COOKIES.userName)?.value || "";
    const avatar = cookieStore.get(TIKTOK_COOKIES.avatar)?.value || "";
    const scope = cookieStore.get("tiktok_scope")?.value || "";

    if (!accessToken || !openId) {
      return NextResponse.json({ connected: false });
    }

    // Comprobar expiración y refrescar si queda <5min
    const expires = expiresAt ? Number(expiresAt) : 0;
    if (expires && Date.now() > expires - 5 * 60 * 1000) {
      // Intentar refresh silencioso
      const refreshToken = cookieStore.get(TIKTOK_COOKIES.refreshToken)?.value;
      if (refreshToken) {
        try {
          const clientKey = process.env.TIKTOK_CLIENT_KEY!;
          const clientSecret = process.env.TIKTOK_CLIENT_SECRET!;
          const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_key: clientKey,
              client_secret: clientSecret,
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            }).toString(),
            cache: "no-store",
          });
          const j = await res.json();
          if (res.ok && j.access_token) {
            const secure = process.env.NODE_ENV === "production";
            const maxAge = j.expires_in || 86400;
            cookieStore.set(TIKTOK_COOKIES.accessToken, j.access_token, {
              httpOnly: true,
              secure,
              sameSite: "lax",
              path: "/",
              maxAge,
            });
            if (j.refresh_token) {
              cookieStore.set(TIKTOK_COOKIES.refreshToken, j.refresh_token, {
                httpOnly: true,
                secure,
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 24 * 30,
              });
            }
            cookieStore.set(TIKTOK_COOKIES.expiresAt, String(Date.now() + maxAge * 1000), {
              httpOnly: true,
              secure,
              sameSite: "lax",
              path: "/",
              maxAge,
            });
            return NextResponse.json({
              connected: true,
              open_id: openId,
              display_name: userName,
              avatar_url: avatar,
              scope,
              refreshed: true,
            });
          }
        } catch {}
      }
      // Si no se pudo refrescar, considerar desconectado
      if (Date.now() > expires) {
        return NextResponse.json({ connected: false, reason: "expired" });
      }
    }

    return NextResponse.json({
      connected: true,
      open_id: openId,
      display_name: userName,
      avatar_url: avatar,
      scope,
      canPublish: scope.includes("video.publish"),
      canUpload: scope.includes("video.upload"),
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
