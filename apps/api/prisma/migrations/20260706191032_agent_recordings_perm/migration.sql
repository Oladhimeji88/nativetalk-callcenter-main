-- Nav is now permission-driven, so the default Agent role needs the `recordings`
-- permission to keep the Recordings library that agents previously always saw.
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{recordings}', '{"enabled": true}'::jsonb, true)
WHERE "isSystem" = true AND "name" = 'Agent';
