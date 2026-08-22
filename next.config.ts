import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: any = {
  allowedDevOrigins: ['192.168.1.5'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
