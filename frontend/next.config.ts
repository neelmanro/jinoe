import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/overview", destination: "/tasks", permanent: true }];
  },
};

export default nextConfig;
