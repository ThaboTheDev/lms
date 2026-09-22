import { NextResponse } from 'next/server';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { destroyCurrentSession } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { env } from '@/lib/env';

export async function POST() {
  const principal = await getCurrentPrincipal();
  await destroyCurrentSession();
  if (principal) {
    await recordAudit(principal, { action: 'auth.sign_out', entityType: 'User', entityId: principal.userId });
  }
  return NextResponse.redirect(new URL('/login', env.APP_URL), { status: 303 });
}
