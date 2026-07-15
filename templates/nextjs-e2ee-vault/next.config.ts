import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16+ defaults to Turbopack. Use `next dev --webpack` (in package.json)
  // because @tidecloak/* packages need the webpack workarounds below.
  webpack: (config) => {
    // Fix 1: @tidecloak/js incomplete re-exports — suppress strict export checking
    config.module.strictExportPresence = false;

    // Fix 2: @tidecloak/react CJS dist contains ESM syntax.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@tidecloak/react": path.resolve(
        __dirname,
        "node_modules/@tidecloak/react/dist/esm/index.js"
      ),
    };

    return config;
  },

  // CSP: frame-src '*' required for Tide SWE iframe (ORK re-homing).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-src 'self' *",
          },
        ],
      },
      // DPoP auth page needs script-src 'unsafe-inline' for enclave.
      {
        source: "/tide_dpop/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'unsafe-inline'",
          },
          {
            key: "Allow-CSP-From",
            value: "*",
          },
        ],
      },
    ];
  },

  // Rewrite /tide_dpop/... to static file. Do NOT use a route handler.
  async rewrites() {
    return [
      {
        source: "/tide_dpop/:path*",
        destination: "/tide_dpop_auth.html",
      },
    ];
  },
};

export default nextConfig;
