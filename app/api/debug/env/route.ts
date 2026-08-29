import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const has = (k: string) => Boolean(process.env[k]);
  const vercelEnv = process.env.VERCEL_ENV || "unknown";
  const vercelUrl = process.env.VERCEL_URL || "unknown";
  const githubPages = process.env.GITHUB_PAGES || "not set";
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/videos (default)";
  return NextResponse.json({
    vercelEnv,
    vercelUrl,
    githubPages,
    basePath,
    tiktok: {
      TIKTOK_CLIENT_KEY: has("TIKTOK_CLIENT_KEY") ? "SET" : "MISSING",
      TIKTOK_CLIENT_SECRET: has("TIKTOK_CLIENT_SECRET") ? "SET" : "MISSING",
      TIKTOK_REDIRECT_URI: has("TIKTOK_REDIRECT_URI") ? "SET" : "MISSING",
      TIKTOK_REDIRECT_URI_VALUE: process.env.TIKTOK_REDIRECT_URI ? process.env.TIKTOK_REDIRECT_URI.slice(0, 40) + "..." : "MISSING",
    },
    hint: "Si ves MISSING, Ve a Vercel → tu proyecto (asegúrate que es viralcreator, no otro) → Settings → Environment Variables → añade las 3 en Production (o Shared vinculada) y haz Redeploy. No pruebes en github.io (siempre MISSING).",
  });
}
