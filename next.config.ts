import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep sharp as an external (native) dependency in server bundles.
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: {
      // Default is 1 MB, which rejected every real photo before the action
      // ever ran. Uploads are downscaled in the browser first (see
      // lib/image-prepare.ts) so they land well under this; the headroom is
      // for the odd format the browser can't re-encode. Staying below
      // Vercel's ~4.5 MB request body cap is deliberate — raising this
      // further wouldn't help in production.
      bodySizeLimit: "4mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      // Supabase Storage public URLs (product image uploads)
      { protocol: "https", hostname: "wrdvivypstwnrrazguuf.supabase.co" },
    ],
  },
};

export default nextConfig;
