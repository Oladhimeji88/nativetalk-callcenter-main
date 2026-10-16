-- RBAC unification: remove legacy split account models, unify on Manager.
-- Adds isSystem flag to ManagerRole for protected system roles.
-- Renames role 'manager' → 'supervisor' to match the three system role names.

-- Remove legacy tables (cascade cleans up FKs in User)
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "UserRole" CASCADE;
DROP TABLE IF EXISTS "UserGroup" CASCADE;
DROP TABLE IF EXISTS "OutgoingRule" CASCADE;

-- Replace adminAccess with isSystem on ManagerRole
ALTER TABLE "ManagerRole" DROP COLUMN IF EXISTS "adminAccess";
ALTER TABLE "ManagerRole" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- Rename the legacy 'manager' role value to 'supervisor'
UPDATE "Manager" SET role = 'supervisor' WHERE role = 'manager';
