import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // This package lives inside the kant-monorepo pnpm workspace — point file
  // tracing at the repo root so Vercel's build doesn't mistake this package
  // for the workspace root when tracing dependencies.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
