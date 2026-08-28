import { createHash, randomBytes } from "crypto";

export function isTikTokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REDIRECT_URI);
}

export function getTikTokEnv() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error(
      "TikTok no configurado en este deployment. Ve a Vercel → tu proyecto → Settings → Environment Variables y añade TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET y TIKTOK_REDIRECT_URI (ej: https://viralcreator.vercel.app/videos/api/tiktok/callback), luego Redeploy. En GitHub Pages (/videos en github.io) el Login siempre dará 404 porque es estático — prueba en Vercel."
    );
  }
  return { clientKey, clientSecret, redirectUri };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

export const TIKTOK_SCOPES = "user.info.basic,video.upload,video.publish";

export const TIKTOK_COOKIES = {
  state: "tiktok_oauth_state",
  verifier: "tiktok_code_verifier",
  accessToken: "tiktok_access_token",
  refreshToken: "tiktok_refresh_token",
  openId: "tiktok_open_id",
  expiresAt: "tiktok_expires_at",
  userName: "tiktok_user_name",
  avatar: "tiktok_avatar_url",
} as const;

export function getBaseUrl(req?: Request): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (req) {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  }
  return "";
}
