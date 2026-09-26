import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, createNonce } from '@/lib/security/csp';
import { embedOrigins, parseEmbedOrigins } from '@/lib/embed';

const PUBLIC_PATHS = [
  '/login',           // includes /login/verify, the second factor step
  '/forgot-password',
  '/reset-password',
  '/apply',
  '/verify',          // public certificate verification
  '/accessibility',   // public accessibility statement
  '/setup',           // first run: open only while no user exists, the page enforces it
  '/api/v1/health',
  '/api/v1/auth/sign-out', // must run even when the cookie is already gone
  '/api/v1/badges',   // public Open Badges assertions for issued credentials
  '/api/v1/packages', // SCORM and H5P files: the signed token in the path is the credential
  '/api/v1/branding', // the institution's logo, shown on the sign-in page
];

function contentSecurityPolicy(nonce: string) {
  return buildContentSecurityPolicy({
    nonce,
    storageEndpoint: process.env.S3_ENDPOINT,
    production: process.env.NODE_ENV === 'production',
    https: (process.env.APP_URL ?? '').startsWith('https://'),
    frameOrigins: embedOrigins(parseEmbedOrigins(process.env.EMBED_ALLOWED_ORIGINS)),
  });
}

/**
 * Edge gate, and the one place the content security policy is issued.
 *
 * The auth check only looks for a session cookie, because the edge runtime has
 * no database access: the real session validation and every permission check
 * happen in the layout, page and route handlers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Package files run in a sandbox with their own policy (set by the route):
  // this site's policy on top would block the package's scripts, and the
  // sandboxed frame has no cookie to show. The token in the path is checked
  // by the route.
  if (pathname.startsWith('/api/v1/packages/')) return NextResponse.next();

  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce);

  const isPublic =
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  if (!isPublic && !request.cookies.has('lms_session')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Next.js reads the nonce from the policy on the request and stamps it on
  // the inline scripts it renders; the browser enforces the one on the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)'],
};
