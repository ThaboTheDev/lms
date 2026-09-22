import { NextResponse } from 'next/server';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { destroyCurrentSession, SESSION_COOKIE, sessionCookieClearOptions } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';

/**
 * Ends the current session and sends the browser to the sign-in page.
 *
 * The redirect is a relative Location. Building it from APP_URL sent anyone
 * not on that exact host (a preview, a reverse proxy, a real domain that had
 * not been copied into the environment) to a machine their browser could not
 * reach, so the button looked broken. A relative path is resolved by the
 * browser against the host it just posted to.
 *
 * The cleared cookie is set on this response. Mutations made through
 * `cookies()` are not reliably attached when the handler returns its own
 * NextResponse, which left the session cookie in place after a "successful"
 * sign out.
 */
export async function POST() {
  try {
    const principal = await getCurrentPrincipal();
    await destroyCurrentSession();
    if (principal) {
      try {
        await recordAudit(principal, {
          action: 'auth.sign_out',
          entityType: 'User',
          entityId: principal.userId,
        });
      } catch (error) {
        console.error('[auth] sign-out audit failed', error);
      }
    }
  } catch (error) {
    console.error('[auth] sign-out failed', error);
    await destroyCurrentSession().catch(() => undefined);
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: '/login' },
  });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieClearOptions());
  return response;
}
