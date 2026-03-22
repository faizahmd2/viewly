import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output bundles everything needed to run without node_modules.
  // Required for Docker/EC2. Comment this out if deploying to Vercel.
  output: "standalone",

  // Allow large image payloads through server actions
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },

  // Image optimization
  images: {
    dangerouslyAllowSVG: false,
    remotePatterns: [],
  },
};

export default nextConfig;