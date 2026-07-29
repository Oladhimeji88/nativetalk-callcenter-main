import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/rbac.guard';

// Small tenant-scoped CRUD helper shared by the simple relational resources.
// `model` is a Prisma delegate name (e.g. 'user', 'userRole').
export function crud(prisma: PrismaService, model: string) {
  const delegate = () => (prisma as any)[model];
  return {
    list: (u: AuthUser) => delegate().findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'asc' } }),
    create: (u: AuthUser, data: any) =>
      delegate().create({ data: { ...sanitize(data), tenantId: u.tenantId } }),
    update: (u: AuthUser, id: string, data: any) =>
      delegate().updateMany({ where: { id, tenantId: u.tenantId }, data: sanitize(data) }),
    remove: (u: AuthUser, id: string) => delegate().deleteMany({ where: { id, tenantId: u.tenantId } }),
  };
}

// Strip fields a client must never set directly.
function sanitize(data: any) {
  const { id, tenantId, createdAt, updatedAt, ...rest } = data ?? {};
  return rest;
}
