import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev-only: lets the localtunnel-exposed URL fetch HMR/dev assets during
  // this session's local walkthroughs. Harmless in production (unused there —
  // this key only affects `next dev`) and not a security-relevant change.
  allowedDevOrigins: ["*.loca.lt", "127.0.0.1", "10.255.5.154", "192.168.1.20"],
};

export default nextConfig;
