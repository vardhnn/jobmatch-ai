import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Explicit project root: the path contains spaces, which otherwise makes
  // Turbopack walk up to the home directory and ignore package-lock.json.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
