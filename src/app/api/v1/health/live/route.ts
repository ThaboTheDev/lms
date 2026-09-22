import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness. Deliberately checks nothing external: if the database is down, the
 * right answer is to stop sending traffic here, not to restart a process that
 * is working perfectly well.
 */
export function GET() {
  return NextResponse.json(
    { status: 'alive', uptimeSeconds: Math.round(process.uptime()) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
