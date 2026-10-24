import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // User media is generated at runtime and must never enter deployment bundles.
  outputFileTracingExcludes: { '/*': ['./storage/**/*', './artifacts/**/*'] },
};

export default nextConfig;
