import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating dev badge so it does not cover the list on phones.
  devIndicators: false,
};

export default nextConfig;
