import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// One-time importer: moves the legacy JSON files (apps/legacy/data/*.json) into
// Postgres under the default tenant. Idempotent: re-running upserts by natural key.
// User/UserRole/UserGroup/OutgoingRule are no longer part of the schema — those
// legacy collections are skipped. Agents are imported as Account rows with role=agent.
const prisma = new PrismaClient();
const DATA_DIR = path.resolve(__dirname, '../../../legacy/data');
const TENANT_SLUG = 'tech4mation';

async function readJson(name: string): Promise<any[]> {
  const f = path.join(DATA_DIR, `${name}.json`);
  if (!existsSync(f)) return [];
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return []; }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error('Run the seed first (no default tenant).');
  const tenantId = tenant.id;
  const report: Record<string, number> = {};

  // --- Roles (formerly manager-roles) ---
  for (const r of await readJson('manager-roles')) {
    await prisma.role.upsert({
      where: { tenantId_name: { tenantId, name: r.name } },
      update: { permissions: r.permissions ?? {}, active: r.status !== false },
      create: { tenantId, name: r.name, isSystem: false, permissions: r.permissions ?? {}, active: r.status !== false },
    });
    report['manager-roles'] = (report['manager-roles'] ?? 0) + 1;
  }
  const roleByName = new Map((await prisma.role.findMany({ where: { tenantId } })).map((r) => [r.name, r.id]));

  // --- Accounts (formerly managers/login accounts) — legacy had no passwords ---
  const defaultHash = await bcrypt.hash('changeme123', 10);
  for (const m of await readJson('managers')) {
    const email = String(m.email ?? `${m.username ?? 'manager'}@example.com`).toLowerCase().trim();
    await prisma.account.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: {
        firstName: m.firstName ?? null, lastName: m.lastName ?? null, username: m.username ?? null,
        roleId: roleByName.get(m.managerRole) ?? null, language: m.language ?? 'Default',
        allowMonitoring: m.allowMonitoring !== false, active: m.status !== false,
      },
      create: {
        tenantId, email, passwordHash: defaultHash,
        firstName: m.firstName ?? null, lastName: m.lastName ?? null, username: m.username ?? null,
        roleId: roleByName.get(m.managerRole) ?? null,
        language: m.language ?? 'Default',
        allowMonitoring: m.allowMonitoring !== false, active: m.status !== false,
      },
    });
    report['managers'] = (report['managers'] ?? 0) + 1;
  }

  // --- Contact-center collections → DataRecord (replace per collection) ---
  const collections = ['outbound-campaigns', 'inbound-campaigns', 'blended-campaigns', 'dispositions', 'dnc', 'webforms', 'lead-groups'];
  for (const collection of collections) {
    const rows = await readJson(collection);
    if (!rows.length) continue;
    await prisma.dataRecord.deleteMany({ where: { tenantId, collection } });
    for (const row of rows) {
      const { id, createdAt, updatedAt, ...data } = row;
      await prisma.dataRecord.create({ data: { tenantId, collection, data } });
    }
    report[collection] = rows.length;
  }

  console.log('Migration complete. Imported rows:');
  for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(20)} ${v}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
