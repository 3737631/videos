import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";

// basePath configurable: en Vercel con dominio propio puedes poner NEXT_PUBLIC_BASE_PATH="" para servir en /
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/videos";

const nextConfig: NextConfig = {
  ...(isGithubPages ? { output: "export" as const } : {}),
  ...(basePath ? { basePath } : {}),
  images: { unoptimized: true },
  trailingSlash: false,
};

export default nextConfig;
