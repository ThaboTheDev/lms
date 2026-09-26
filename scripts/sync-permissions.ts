/**
 * Syncs the permission catalogue and the system roles into the database.
 * Safe to run on every deploy: it adds new keys, updates descriptions and
 * re-attaches role permissions without touching custom roles.
 */
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "../src/lib/rbac/permissions";
import { SYSTEM_ROLES } from "../src/lib/rbac/roles";

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
    // System roles belong to no institution, so their key is (NULL, key) -
    // and Prisma refuses null inside a compound-unique upsert: every field of
    // a compound unique must be non-null, and `null as never` only silenced
    // the type checker, not the runtime validator. Find first, then update or
    // create - the same shape roles.ts already uses for institution roles.
    const existing = await prisma.role.findFirst({
      where: { institutionId: null, key: role.key },
      select: { id: true },
    });
    const record = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: {
            name: role.name,
            description: role.description,
            isSystem: true,
          },
        })
      : await prisma.role.create({
          data: {
            key: role.key,
            name: role.name,
            description: role.description,
            isSystem: true,
          },
        });

    if (role.permissions === "*") continue;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...role.permissions] } },
      select: { id: true },
    });

    // An institution's own copy of a system role (the seed makes them, and
    // role lookup prefers them) follows the catalogue too. System roles cannot
    // be edited on screen, so a copy left alone would silently keep whatever
    // permissions the catalogue had on the day it was made.
    const copies = await prisma.role.findMany({
      where: { key: role.key, isSystem: true, institutionId: { not: null } },
      select: { id: true },
    });

    for (const target of [record, ...copies]) {
      await prisma.rolePermission.deleteMany({ where: { roleId: target.id } });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: target.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`system roles synced: ${SYSTEM_ROLES.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
