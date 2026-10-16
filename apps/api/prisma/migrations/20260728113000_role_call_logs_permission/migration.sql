-- Backfill: give every existing role the new call_logs permission (enabled).
-- The Call Logs page was previously gated on analytics; call_logs makes it a
-- separate toggle and lets agents see their own calls. Admins can switch it
-- off per role afterwards.
UPDATE "Role"
SET permissions = permissions || '{"call_logs": {"enabled": true}}'::jsonb
WHERE NOT (permissions ? 'call_logs');
