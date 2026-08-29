import { createHash, randomBytes } from "crypto";

export function getMissingTikTokVars(): string[] {
  const missing: string[] = [];
  if (!process.env.TIKTOK_CLIENT_KEY) missing.push("TIKTOK_CLIENT_KEY");
  if (!process.env.TIKTOK_CLIENT_SECRET) missing.push("TIKTOK_CLIENT_SECRET");
  if (!process.env.TIKTOK_REDIRECT_URI) missing.push("TIKTOK_REDIRECT_URI");
  return missing;
}

export function isTikTokConfigured(): boolean {
  return getMissingTikTokVars().length === 0;
}

export function getTikTokEnv() {
  const missing = getMissingTikTokVars();
  if (missing.length > 0) {
    throw new Error(
      `TikTok no configurado en este deployment Vercel. Faltan: ${missing.join(", ")}. Las pusiste en "Shared" pero no están vinculadas a este proyecto. Ve a Vercel → viralcreator → Settings → Environment Variables → si están en Shared, dale a "Link to Project" y selecciona viralcreator, o mejor añádelas directamente en "Production" para este proyecto y haz Redeploy. Prueba siempre en https://viralcreator.vercel.app/videos (en github.io siempre da 404).`
    );
  }
  return {
    clientKey: process.env.TIKTOK_CLIENT_KEY!,
    clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
    redirectUri: process.env.TIKTOK_REDIRECT_URI!,
  };
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
