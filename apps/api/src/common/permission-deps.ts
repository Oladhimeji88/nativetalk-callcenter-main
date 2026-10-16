// Permission dependencies: enabling the key requires (and auto-enables) its deps.
// Kept in sync with the same map in the web Roles page. Transitive — e.g. `live`
// pulls in `softphone`, which pulls in `contacts`.
export const PERMISSION_DEPS: Record<string, string[]> = {
  softphone: ['contacts'],   // Call Console looks up contacts for caller ID + notes
  live: ['softphone'],       // monitoring rings the supervisor's own softphone
  campaigns: ['contacts'],   // the campaign wizard reads contact groups for lead sources
  team_scope: ['team'],      // "restrict to own team" needs "manage a team"
};

/**
 * Return a copy of a role's permissions with every dependency of an enabled
 * permission also enabled (applied transitively until stable). This is the
 * authoritative normalisation — a saved role can never be internally inconsistent.
 */
export function resolvePermissionDeps(permissions: any): Record<string, { enabled?: boolean; items?: any }> {
  const out: Record<string, any> = { ...(permissions || {}) };
  const on = (k: string) => !!out[k]?.enabled;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [perm, deps] of Object.entries(PERMISSION_DEPS)) {
      if (!on(perm)) continue;
      for (const dep of deps) {
        if (!on(dep)) { out[dep] = { ...(out[dep] || {}), enabled: true }; changed = true; }
      }
    }
  }
  return out;
}
