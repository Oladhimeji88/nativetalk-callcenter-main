-- Rename Manager → Account, ManagerRole → Role, managerRoleId → roleId
-- Keeps all data intact — pure rename, no structural changes.

ALTER TABLE "Manager" RENAME TO "Account";
ALTER TABLE "ManagerRole" RENAME TO "Role";

ALTER TABLE "Account" RENAME COLUMN "managerRoleId" TO "roleId";

-- Primary key constraints (actual constraints — use RENAME CONSTRAINT)
ALTER TABLE "Account" RENAME CONSTRAINT "Manager_pkey" TO "Account_pkey";
ALTER TABLE "Role" RENAME CONSTRAINT "ManagerRole_pkey" TO "Role_pkey";

-- Foreign key constraints
ALTER TABLE "Account" RENAME CONSTRAINT "Manager_tenantId_fkey" TO "Account_tenantId_fkey";
ALTER TABLE "Account" RENAME CONSTRAINT "Manager_managerRoleId_fkey" TO "Account_roleId_fkey";
ALTER TABLE "Role" RENAME CONSTRAINT "ManagerRole_tenantId_fkey" TO "Role_tenantId_fkey";

-- Unique indexes (created with CREATE UNIQUE INDEX — must use ALTER INDEX, not RENAME CONSTRAINT)
ALTER INDEX "Manager_tenantId_email_key" RENAME TO "Account_tenantId_email_key";
ALTER INDEX "ManagerRole_tenantId_name_key" RENAME TO "Role_tenantId_name_key";

-- Regular indexes
ALTER INDEX "Manager_tenantId_idx" RENAME TO "Account_tenantId_idx";
ALTER INDEX "ManagerRole_tenantId_idx" RENAME TO "Role_tenantId_idx";
