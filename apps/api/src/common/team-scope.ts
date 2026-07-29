import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './rbac.guard';

/**
 * Team-scoped access: a manager whose role has the `team_scope` permission may
 * only see and manage the users beneath them in the org tree. Admins and
 * super-admins are never scoped (they see the whole tenant).
 */
export function isTeamScoped(user: AuthUser): boolean {
  if (user.superAdmin) return false;
  return !!(user.permissions as any)?.team_scope?.enabled;
}

/**
 * The set of account ids a user is allowed to see/manage:
 *  - `null`  → unrestricted (sees the whole tenant)
 *  - array   → themselves plus everyone under them in the manager tree (all the
 *              way down: their reports, their reports' reports, …)
 */
export async function teamScopeIds(prisma: PrismaService, user: AuthUser): Promise<string[] | null> {
  if (!isTeamScoped(user)) return null;
  const all = await prisma.account.findMany({
    where: { tenantId: user.tenantId },
    select: { id: true, managerId: true },
  });
  const children = new Map<string, string[]>();
  for (const a of all) {
    if (!a.managerId) continue;
    const arr = children.get(a.managerId) ?? [];
    arr.push(a.id);
    children.set(a.managerId, arr);
  }
  const ids = new Set<string>([user.id]);
  const stack = [user.id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of children.get(cur) ?? []) {
      if (!ids.has(child)) { ids.add(child); stack.push(child); }
    }
  }
  return [...ids];
}

/**
 * The agent extensions of a user's team, or `null` when unrestricted. Used to
 * scope call logs / dashboard metrics (which key off the extension, not the
 * account id) to the team.
 */
export async function teamScopeExtensions(prisma: PrismaService, user: AuthUser): Promise<string[] | null> {
  const ids = await teamScopeIds(prisma, user);
  if (!ids) return null;
  const accts = await prisma.account.findMany({
    where: { tenantId: user.tenantId, id: { in: ids }, agentExtension: { not: null } },
    select: { agentExtension: true },
  });
  return accts.map((a) => a.agentExtension!).filter(Boolean);
}
