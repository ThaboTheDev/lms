import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',           // includes /login/verify, the second factor step
  '/forgot-password',
  '/reset-password',
  '/apply',
  '/verify',          // public certificate verification
  '/accessibility',   // public accessibility statement
  '/api/v1/health',
];

/**
 * Edge gate. This only checks that a session cookie is present, because the
 * edge runtime has no database access: the real session validation and every
 * permission check happen in the layout, page and route handlers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  if (isPublic) return NextResponse.next();

  const hasSession = request.cookies.has('lms_session');
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)'],
};
