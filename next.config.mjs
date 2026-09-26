/** @type {import('next').NextConfig} */

/**
 * Security headers that do not change per request. The content security
 * policy is not here: it carries a per-request nonce, so src/middleware.ts
 * issues it (see src/lib/security/csp.ts). A static policy here as well would
 * be enforced alongside that one and block the very scripts the nonce allows.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// Production refuses to be framed. That is the right default for a system that
// holds academic records, but it also stops the app being shown inside a
// preview pane, so the refusal is applied in production only (the policy's
// frame-ancestors follows the same rule).
const isProduction = process.env.NODE_ENV === "production";
const frameHeaders = isProduction ? [{ key: "X-Frame-Options", value: "DENY" }] : [];

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  typedRoutes: true,
  // Development only: the dev server may be opened from a hosted preview origin.
  allowedDevOrigins: ["*.e2b.app", "*.devtunnels.ms", "*.app.github.dev", "localhost", "127.0.0.1"],
  experimental: {
    // forbidden() and a 403 page: a permission refusal renders as "not allowed"
    // with status 403 instead of a 500 "could not be loaded".
    authInterrupts: true,
    serverActions: {
      allowedOrigins: [
        "*.e2b.app",
        "*.devtunnels.ms",
        "*.app.github.dev",
        "localhost:3000",
        "127.0.0.1:3000",
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, ...frameHeaders],
      },
      {
        // Nothing behind authentication should ever be cached by a proxy.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
