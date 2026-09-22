/**
 * Syncs the permission catalogue and the system roles into the database.
 * Safe to run on every deploy: it adds new keys, updates descriptions and
 * re-attaches role permissions without touching custom roles.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/lib/rbac/permissions';
import { SYSTEM_ROLES } from '../src/lib/rbac/roles';

const prisma = new PrismaClient();

async function main() {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, group: meta.group, description: meta.description },
      update: { group: meta.group, description: meta.description },
    });
  }
  console.log(`permissions synced: ${Object.keys(PERMISSIONS).length}`);

  for (const role of SYSTEM_ROLES) {
    const record = await prisma.role.upsert({
      where: { institutionId_key: { institutionId: null as never, key: role.key } },
      create: { key: role.key, name: role.name, description: role.description, isSystem: true },
      update: { name: role.name, description: role.description, isSystem: true },
    });

    if (role.permissions === '*') continue;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...role.permissions] } },
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: record.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.log(`system roles synced: ${SYSTEM_ROLES.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
