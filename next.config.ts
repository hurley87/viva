import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@privy-io/react-auth", "@openai/agents"],
};

export default nextConfig;
