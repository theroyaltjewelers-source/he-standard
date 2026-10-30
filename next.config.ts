import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Long journal entries are sent through a Server Action. The default 1 MB
  // request limit is raised so an entry at the 1,000,000-character cap (plus
  // the other form fields) always fits. Vercel itself accepts up to 4.5 MB.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  // Every page in this app is private and per-user, so Cache Components /
  // partial prerendering are left off: all pages render on request.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(self), microphone=(self)" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
