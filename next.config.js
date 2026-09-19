// next.config.js — RagGen.
//
// This app serves both halves: the SPA (built by web/ into public/video-generator/) and
// the /api/video-generator/* handlers. The rewrites below match the SPA's Vite base
// ("/video-generator/") and React Router basename, and `/` lands on the studio.
//
// Next has already loaded .env by the time it evaluates this file, and this is the earliest
// hook that runs in the process that serves requests — so it is where the Postgres URL gets
// composed from the DB_* vars (password kept separately in DB_PASSWORD). Route handlers
// construct Prisma later, by which point TENANT_DATABASE_URL is populated. lib/db.ts also
// resolves the URL itself, so neither path depends on the other.
require("./lib/db-url.cjs").applyTenantDatabaseUrl();

const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
    // Without this, Next's build-time file tracing walks up looking for a common root and can
    // hit protected Windows junctions (e.g. C:\Users\<user>\Application Data), failing the
    // build with EPERM. Pinning the root to this project directory keeps tracing local.
    outputFileTracingRoot: path.join(__dirname),
  },

  async redirects() {
    return [{ source: "/", destination: "/video-generator", permanent: false }];
  },

  // `afterFiles` runs AFTER static-file checks, so real assets
  // (public/video-generator/assets/*, index.html) are served directly and only unmatched
  // client-router deep links (e.g. /video-generator/generate) fall back to index.html.
  async rewrites() {
    return {
      afterFiles: [
        { source: "/video-generator", destination: "/video-generator/index.html" },
        { source: "/video-generator/:path*", destination: "/video-generator/index.html" },
      ],
    };
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

module.exports = nextConfig;
