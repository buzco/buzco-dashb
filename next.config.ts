import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep sharp as an external (native) dependency in server bundles.
  serverExternalPackages: ["sharp"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      // Supabase Storage public URLs (product image uploads)
      { protocol: "https", hostname: "wrdvivypstwnrrazguuf.supabase.co" },
    ],
  },
};

export default nextConfig;
