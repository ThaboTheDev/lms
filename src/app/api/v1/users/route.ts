import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { parsePaging, toErrorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Example of the pattern every collection endpoint follows:
 * authenticate, authorise, scope to the tenant, paginate, project only the
 * fields the caller is entitled to see.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requirePrincipal();
    requirePermission(principal, 'user.read');

    const { searchParams } = request.nextUrl;
    const { page, perPage, skip } = parsePaging(searchParams);
    const query = searchParams.get('q')?.trim();

    const where = {
      institutionId: principal.institutionId,
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: 'insensitive' as const } },
              { lastName: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: perPage,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          lastLoginAt: true,
          userRoles: { select: { role: { select: { key: true, name: true } } } },
        },
      }),
    ]);

    return NextResponse.json({
      data: users.map((user) => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        roles: user.userRoles.map((r) => r.role.name),
      })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
