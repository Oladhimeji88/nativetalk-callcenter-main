import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ensureSystemDispositions } from '../src/dialer/system-dispositions';

// Idempotent: safe to run after every migration.
const prisma = new PrismaClient();

const TENANT_SLUG = 'tech4mation';
const ADMIN_EMAIL = 'admin@tech4mationlimited.com';
const COMPANY_ADMIN_EMAIL = 'company.admin@tech4mation.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';

const SYSTEM_ROLES = [
  {
    name: 'Admin',
    permissions: {
      softphone:  { enabled: true },
      contacts:   { enabled: true },
      live:       { enabled: true },
      queues:     { enabled: true },
      campaigns:  { enabled: true },
      recordings: { enabled: true },
      analytics:  { enabled: true },
      call_logs:  { enabled: true },
      pbx:        { enabled: true },
      users:      { enabled: true },
      billing:    { enabled: true },
      team:       { enabled: true },
    },
  },
  {
    name: 'Supervisor',
    permissions: {
      softphone:  { enabled: true },
      contacts:   { enabled: true },
      live:       { enabled: true },
      queues:     { enabled: true },
      campaigns:  { enabled: true },
      recordings: { enabled: true },
      analytics:  { enabled: true },
      call_logs:  { enabled: true },
      pbx:        { enabled: false },
      users:      { enabled: false },
      billing:    { enabled: false },
      team:       { enabled: true },
    },
  },
  {
    name: 'Agent',
    permissions: {
      softphone:  { enabled: true },
      contacts:   { enabled: true },
      live:       { enabled: false },
      queues:     { enabled: false },
      campaigns:  { enabled: false },
      recordings: { enabled: true },
      analytics:  { enabled: false },
      call_logs:  { enabled: true },
      pbx:        { enabled: false },
      users:      { enabled: false },
      billing:    { enabled: false },
      team:       { enabled: false },
    },
  },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: { slug: TENANT_SLUG, name: 'Tech4mation' },
  });

  // Seed/update the three protected system roles.
  const roles: Record<string, string> = {};
  for (const sr of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: sr.name } },
      update: { isSystem: true, permissions: sr.permissions },
      create: { tenantId: tenant.id, name: sr.name, isSystem: true, permissions: sr.permissions },
    });
    roles[sr.name] = role.id;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Platform operator (super admin) — manages companies. Lands in the (future)
  // super-admin portal.
  await prisma.account.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
    update: { roleId: roles['Admin'], active: true },
    create: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      passwordHash,
      firstName: 'Platform',
      lastName: 'Admin',
      username: 'admin',
      roleId: roles['Admin'],
      superAdmin: true,
    },
  });

  // Company admin (NOT super admin) — the pure company-admin portal experience.
  await prisma.account.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: COMPANY_ADMIN_EMAIL } },
    update: { roleId: roles['Admin'], active: true, agentExtension: '1001' },
    create: {
      tenantId: tenant.id,
      email: COMPANY_ADMIN_EMAIL,
      passwordHash,
      firstName: 'Company',
      lastName: 'Admin',
      username: 'company-admin',
      roleId: roles['Admin'],
      agentExtension: '1001',
      superAdmin: false,
    },
  });
  await prisma.extension.upsert({
    where: { tenantId_extension: { tenantId: tenant.id, extension: '1001' } },
    update: {},
    create: { tenantId: tenant.id, extension: '1001', password: 'Ext-1001-dev', displayName: 'Company Admin' },
  });

  await ensureSystemDispositions(prisma, tenant.id);

  console.log(`Seeded tenant "${tenant.name}" with 3 system roles (Admin, Supervisor, Agent) + system dispositions`);
  console.log(`Super admin:   ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  console.log(`Company admin: ${COMPANY_ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}  (ext 1001)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
