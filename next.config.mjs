/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: "/videos",
  images: { unoptimized: true },
};

export default nextConfig;