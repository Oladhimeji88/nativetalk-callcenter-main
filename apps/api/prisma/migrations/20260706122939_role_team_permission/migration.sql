-- Backfill the "team" (Manage a team) permission onto existing roles so cloned
-- roles carry it and existing supervisors/admins keep the ability to be managers.
-- Only touch roles that don't already have the key.

-- Admin + Supervisor system roles: can manage a team.
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{team}', '{"enabled": true}'::jsonb, true)
WHERE "isSystem" = true
  AND "name" IN ('Admin', 'Supervisor')
  AND NOT ("permissions" ? 'team');

-- Agent system role: cannot.
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{team}', '{"enabled": false}'::jsonb, true)
WHERE "isSystem" = true
  AND "name" = 'Agent'
  AND NOT ("permissions" ? 'team');