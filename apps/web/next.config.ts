import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @exam-sprint/core ships TypeScript source; let Next compile it.
  transpilePackages: ["@exam-sprint/core"],
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  poweredByHeader: false,
};

export default nextConfig;
