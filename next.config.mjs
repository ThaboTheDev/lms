/** @type {import('next').NextConfig} */

/**
 * Content security policy. 'unsafe-inline' on styles is needed because the
 * design system sets custom properties inline for per-institution branding;
 * scripts carry no such exception. Everything else is locked to the origin,
 * because this application has no reason to load anything from anywhere else.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

// Production refuses to be framed. That is the right default for a system that
// holds academic records, but it also stops the app being shown inside a
// preview pane, so the refusal is applied in production only. Nothing about a
// deployed build changes.
const isProduction = process.env.NODE_ENV === 'production';
const frameHeaders = isProduction
  ? [
      { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      { key: 'X-Frame-Options', value: 'DENY' },
    ]
  : [
      {
        key: 'Content-Security-Policy',
        value: contentSecurityPolicy.replace("frame-ancestors 'none'", 'frame-ancestors *'),
      },
    ];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  // Development only: the dev server may be opened from a hosted preview origin.
  allowedDevOrigins: ['*.e2b.app', 'localhost', '127.0.0.1'],
  experimental: { typedRoutes: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders.filter((header) => header.key !== 'Content-Security-Policy' && header.key !== 'X-Frame-Options'), ...frameHeaders],
      },
      {
        // Nothing behind authentication should ever be cached by a proxy.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
