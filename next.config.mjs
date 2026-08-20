/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: "/videos",
  assetPrefix: "/videos/",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;