import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
  getTikTokEnv,
  TIKTOK_SCOPES,
  TIKTOK_COOKIES,
} from "@/lib/tiktokAuth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const { clientKey, redirectUri } = getTikTokEnv();
    const state = generateState();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    const cookieStore = await cookies();
    const secure = process.env.NODE_ENV === "production";

    cookieStore.set(TIKTOK_COOKIES.state, state, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    cookieStore.set(TIKTOK_COOKIES.verifier, verifier, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const params = new URLSearchParams({
      client_key: clientKey,
      scope: TIKTOK_SCOPES,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const authUrl = `https://www.tiktok.com/v2/auth/authorize?${params.toString()}`;
    return NextResponse.redirect(authUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error auth";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
