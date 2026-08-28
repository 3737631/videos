import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTikTokEnv, TIKTOK_COOKIES } from "@/lib/tiktokAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  // Base para redirigir de vuelta a la app (con basePath)
  const basePath = "/videos";
  const appUrl = new URL(basePath + "/", req.url).toString().replace(/\/$/, "/");

  if (error) {
    return NextResponse.redirect(`${appUrl}?tiktok_error=${encodeURIComponent(errorDesc || error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}?tiktok_error=${encodeURIComponent("Falta code/state")}`);
  }

  try {
    const cookieStore = await cookies();
    const storedState = cookieStore.get(TIKTOK_COOKIES.state)?.value;
    const verifier = cookieStore.get(TIKTOK_COOKIES.verifier)?.value;

    if (!storedState || storedState !== state) {
      return NextResponse.redirect(`${appUrl}?tiktok_error=${encodeURIComponent("State inválido")}`);
    }
    if (!verifier) {
      return NextResponse.redirect(`${appUrl}?tiktok_error=${encodeURIComponent("Falta verifier")}`);
    }

    const { clientKey, clientSecret, redirectUri } = getTikTokEnv();

    // Intercambiar code por tokens
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
      cache: "no-store",
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || tokenJson.error) {
      const msg = tokenJson.error_description || tokenJson.error || `Token ${tokenRes.status}`;
      return NextResponse.redirect(`${appUrl}?tiktok_error=${encodeURIComponent(msg)}`);
    }

    const accessToken: string = tokenJson.access_token;
    const refreshToken: string = tokenJson.refresh_token;
    const openId: string = tokenJson.open_id || tokenJson.openId;
    const expiresIn: number = tokenJson.expires_in || 86400;
    const scope: string = tokenJson.scope || "";

    if (!accessToken || !openId) {
      return NextResponse.redirect(`${appUrl}?tiktok_error=${encodeURIComponent("Respuesta token incompleta")}`);
    }

    // Obtener info de usuario
    let displayName = "";
    let avatarUrl = "";
    try {
      const userRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const userJson = await userRes.json();
      const user = userJson?.data?.user;
      if (user) {
        displayName = user.display_name || "";
        avatarUrl = user.avatar_url || "";
      }
    } catch {
      // no crítico
    }

    const secure = process.env.NODE_ENV === "production";
    const maxAge = expiresIn;

    // Limpiar state/verifier y guardar tokens httpOnly
    cookieStore.delete(TIKTOK_COOKIES.state);
    cookieStore.delete(TIKTOK_COOKIES.verifier);

    cookieStore.set(TIKTOK_COOKIES.accessToken, accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    cookieStore.set(TIKTOK_COOKIES.refreshToken, refreshToken || "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    cookieStore.set(TIKTOK_COOKIES.openId, openId, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    cookieStore.set(TIKTOK_COOKIES.expiresAt, String(Date.now() + expiresIn * 1000), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    if (displayName) {
      cookieStore.set(TIKTOK_COOKIES.userName, displayName, {
        httpOnly: false,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge,
      });
    }
    if (avatarUrl) {
      cookieStore.set(TIKTOK_COOKIES.avatar, avatarUrl, {
        httpOnly: false,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge,
      });
    }
    // Guardar scope para decidir publish vs upload
    cookieStore.set("tiktok_scope", scope, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    });

    return NextResponse.redirect(`${appUrl}?tiktok=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error callback";
    const base = new URL("/videos/", req.url).toString().replace(/\/$/, "/");
    return NextResponse.redirect(`${base}?tiktok_error=${encodeURIComponent(msg)}`);
  }
}
