import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev-only: lets the localtunnel-exposed URL fetch HMR/dev assets during
  // this session's local walkthroughs. Harmless in production (unused there —
  // this key only affects `next dev`) and not a security-relevant change.
  allowedDevOrigins: ["*.loca.lt"],
};

export default nextConfig;
