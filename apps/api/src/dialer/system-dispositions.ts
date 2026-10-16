// The standard fallback dispositions the dialer assigns automatically when no
// agent picked one. Their names MUST match what `dispoFor()` / the success
// default produce, so an auto-assigned value is a real catalog entry. Seeded per
// tenant and protected (isSystem) so they can't be deleted or renamed.
export const SYSTEM_DISPOSITIONS: { name: string; category: string; code: string }[] = [
  { name: 'Answered',     category: 'Success', code: 'ANSWERED' },
  { name: 'No Answer',    category: 'Failure', code: 'NO_ANSWER' },
  { name: 'Busy',         category: 'Failure', code: 'BUSY' },
  { name: 'Failed',       category: 'Failure', code: 'FAILED' },
  { name: 'System Error', category: 'Failure', code: 'SYS_ERROR' },
];

/** Idempotently ensure a tenant has the standard system dispositions. Matches by
 *  name so a tenant that already created e.g. "Failed" just gets it marked system
 *  (with a category if it had none) rather than duplicated. */
// `prisma` is a PrismaService (Nest) or PrismaClient (seed script) — both expose
// `.disposition`, so this stays framework-agnostic.
export async function ensureSystemDispositions(prisma: any, tenantId: string): Promise<void> {
  for (const d of SYSTEM_DISPOSITIONS) {
    const existing = await prisma.disposition.findFirst({ where: { tenantId, name: d.name } });
    if (existing) {
      await prisma.disposition.update({
        where: { id: existing.id },
        data: { isSystem: true, category: existing.category ?? d.category, code: existing.code ?? d.code },
      });
    } else {
      await prisma.disposition.create({
        data: { tenantId, name: d.name, category: d.category, code: d.code, isSystem: true, active: true },
      });
    }
  }
}
